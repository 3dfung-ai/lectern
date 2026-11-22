"""End-to-end checks for Lectern against the test server (node tests/server.js 8799).
Run: python3 tests/e2e.py <folder with test decks>"""
import json, sys, time, urllib.request, zipfile, io, os
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8799/'
EXEC = BASE + 'exec'
KEY = 'testkey123'
DECKS = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/lectern-tests'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(detail)) if detail and not cond else ''))
def state(): return json.load(urllib.request.urlopen(BASE + '__state'))
def put(folder, name, path):
    req = urllib.request.Request(BASE + f'__put?folder={urllib.parse.quote(folder)}&name={urllib.parse.quote(name)}', data=open(path, 'rb').read(), method='POST')
    return json.load(urllib.request.urlopen(req))
import urllib.parse

def wait(page, js, timeout=30000):
    page.wait_for_function(js, timeout=timeout)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    A = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pa = A.new_page()
    errs = []
    pa.on('pageerror', lambda e: errs.append(str(e)))
    pa.goto(BASE)
    pa.wait_for_selector('.modal')                     # first-run tour
    check('tour shows on first run', 'How a talk gets made' in pa.inner_text('.modal'))
    pa.click('.mfoot .btn.primary')
    check('empty library invites a drop', pa.is_visible('.drop-hero'))

    # ---- add a talk with the file picker
    with pa.expect_file_chooser() as fc:
        pa.click('text=Add a talk')
    fc.value.set_files(os.path.join(DECKS, 'poct9_v001_60min_full.pptx'))
    wait(pa, "document.querySelectorAll('.card').length >= 1")
    info = pa.evaluate("(() => { const d = liveDecks()[0], v = deckVer(d); return { title: d.title, n: v.slides.length, hidden: v.slides.filter(s => s.hidden).length, notes: v.slides.map(s => s.notes), talkMin: d.talkMin, key: d.key }; })()")
    check('pptx read: 6 slides', info['n'] == 6, info)
    check('hidden slide detected', info['hidden'] == 1)
    check('notes keep paragraphs', '\n\nThat is the second paragraph.' in info['notes'][4], info['notes'][4])
    check('slide with no notes page reads as empty', info['notes'][3] == '')
    check('talk length from file name (60min)', info['talkMin'] == 60)
    check('file key ignores version', info['key'] == 'poct9_60min_full', info['key'])

    # ---- open, navigate
    pa.click('.card')
    pa.wait_for_selector('.deck .stage')
    check('opens in Review with tabs', pa.is_visible('.tab.on') and 'Review' in pa.inner_text('.tab.on'))
    check('rail shows the steps', all(x in pa.inner_text('.railrow') for x in ['Make', 'Rehearse', 'Present', 'Improve']))
    check('Next suggests a timed run', 'timed run' in pa.inner_text('.next').lower(), pa.inner_text('.next'))
    pa.keyboard.press('ArrowRight'); pa.keyboard.press('ArrowRight')
    check('arrow keys move slides', pa.inner_text('#counter b') == '3')
    pa.keyboard.press('5'); pa.keyboard.press('Enter')
    check('typing 5 + Enter jumps', pa.inner_text('#counter b') == '5')
    check('script shows notes, readable', 'second paragraph' in pa.inner_text('#script'))
    pa.keyboard.press('Home'); pa.keyboard.press('ArrowRight')
    check('pause tag shown as a mark', pa.locator('#script .pausemark').count() == 1)
    pa.keyboard.press('Home')
    check('opening remarks labelled', 'Opening remarks' in pa.inner_text('#script'))

    # ---- edit notes (E), on a slide with notes and on one without a notes page
    pa.keyboard.press('ArrowRight')
    pa.keyboard.press('e')
    pa.wait_for_selector('#noteedit')
    pa.fill('#noteedit', 'So. A result gets challenged. [Pause] What could be going on?\nFirst, the specimen. EDITED IN LECTERN.')
    pa.keyboard.press('Escape')
    time.sleep(0.5)
    check('edit bar appears', pa.is_visible('#editbar') and '1 slide edited' in pa.inner_text('#editbar'))
    pa.keyboard.press('4'); pa.keyboard.press('Enter')
    pa.click('.act-edit')
    pa.fill('#noteedit', 'Brand new notes on a slide that had none.')
    pa.keyboard.press('Escape'); time.sleep(0.5)
    check('edit bar counts 2', '2 slides edited' in pa.inner_text('#editbar'))
    pa.reload(); pa.wait_for_selector('.deck .stage'); time.sleep(0.5)
    check('drafts survive a reload', pa.is_visible('#editbar') and '2 slides edited' in pa.inner_text('#editbar'))
    pa.click('#editbar .btn.primary')
    wait(pa, "!document.querySelector('#editbar')", 20000)
    v2 = pa.evaluate("(() => { const d = liveDecks()[0], v = deckVer(d); return { n: v.n, from: v.from, notes2: v.slides[1].notes, notes4: v.slides[3].notes, notes5: v.slides[4].notes, note: v.note }; })()")
    check('saved as version 2', v2['n'] == 2 and v2['from'] == 'notes', v2)
    check('edited notes read back', 'EDITED IN LECTERN' in v2['notes2'] and v2['notes4'].startswith('Brand new notes'), v2)
    check('untouched notes unchanged', v2['notes5'] == info['notes'][4])
    # the .pptx itself, read by python-pptx and LibreOffice
    with pa.expect_download() as dl:
        pa.evaluate("downloadOriginal(liveDecks()[0])")
    path = dl.value.path()
    from pptx import Presentation
    pr = Presentation(path)
    nts = [s.notes_slide.notes_text_frame.text if s.has_notes_slide else None for s in pr.slides]
    check('python-pptx opens saved file', len(nts) == 6)
    check('python-pptx sees edited notes', 'EDITED IN LECTERN' in nts[1] and nts[3] == 'Brand new notes on a slide that had none.', nts)
    check('python-pptx sees other notes intact', nts[4] == info['notes'][4] and nts[0] == info['notes'][0], (nts[0], info['notes'][0]))
    orig = zipfile.ZipFile(os.path.join(DECKS, 'poct9_v001_60min_full.pptx')); new = zipfile.ZipFile(path)
    same = [n for n in orig.namelist() if n.startswith('ppt/slides/slide') and orig.read(n) == new.read(n)]
    check('slide parts untouched', len(same) == len([n for n in orig.namelist() if n.startswith('ppt/slides/slide')]), same)
    import subprocess, tempfile
    out = tempfile.mkdtemp(); subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', out, path], capture_output=True, timeout=120)
    check('LibreOffice opens saved file', any(f.endswith('.pdf') for f in os.listdir(out)))

    # ---- flag a slide (C)
    pa.keyboard.press('3'); pa.keyboard.press('Enter')
    pa.keyboard.press('c'); pa.wait_for_selector('.modal textarea')
    pa.fill('.modal textarea', 'chart labels too small'); pa.keyboard.press('Enter')
    time.sleep(0.4)
    check('flag closes the box, stays on slide', not pa.is_visible('.modal') and pa.inner_text('#counter b') == '3')
    check('slide shows its flag', '1 flag' in pa.inner_text('#counter'))
    check('Improve step counts flag + notes edit', '2' in pa.inner_text('.step.improve'), pa.inner_text('.step.improve'))

    # ---- rehearse: timed run + report, cue cards
    pa.keyboard.press('r'); pa.wait_for_selector('#rbar')
    pa.click('text=Start timed run'); time.sleep(1.2)
    check('run clock shows', pa.is_visible('#hud .clk'))
    for _ in range(5): pa.keyboard.press('ArrowRight'); time.sleep(0.15)
    pa.click('text=Finish run'); pa.wait_for_selector('.report')
    check('run report opens', 'How the run went' in pa.inner_text('.modal'))
    pa.click('.mfoot .btn.primary')
    pa.click('.ropts >> text=More'); pa.click('.menu >> text=Cue cards')
    pa.keyboard.press('Home'); pa.keyboard.press('ArrowRight')
    check('cue cards hide the middle', pa.locator('#script .reveal').count() == 1 or 'So.' in pa.inner_text('#script'))

    # ---- search across talks
    pa.goto(BASE + '#/')
    pa.fill('#libq', 'specimen'); time.sleep(0.5)
    check('search finds slides', pa.locator('.hit').count() >= 1)
    pa.fill('#libq', '')

    # ---- print view
    did = pa.evaluate("liveDecks()[0].id")
    pa.goto(BASE + f'#/print/{did}'); pa.wait_for_selector('.pslide')
    check('print view lists visible slides', pa.locator('.pslide').count() == 5)

    # ---- connect Drive sync (device A)
    pa.goto(BASE + '#/')
    ok = pa.evaluate(f"applySync('{EXEC}', '{KEY}', 'Laptop')")
    check('sync connects', ok)
    wait(pa, "App.queue.length === 0 && !Sync.qBusy && !Sync.busy", 90000)
    pa.evaluate("syncNow(false)"); wait(pa, "!Object.keys(App.sync.dirty).length && !Sync.busy", 30000)
    st = state()
    names = [(f['folder'], f['name']) for f in st['files'] if not f['trashed']]
    check('versions saved in Drive', any('_versions' in f and n.startswith('v001') for f, n in names) and any('_versions' in f and n.startswith('v002') for f, n in names), names)
    check('current .pptx in Decks', any(f == 'Lectern/Decks' and n.endswith('.pptx') for f, n in names))
    check('pictures drawn and saved (zip)', any(f == 'Lectern/_data/pics' for f, n in names))
    check('flag reached Requests', any(f == 'Lectern/Requests' for f, n in names))
    req = [f for f in st['files'] if f['folder'] == 'Lectern/Requests'][0]
    pics = pa.evaluate("(async () => { const v = deckVer(liveDecks()[0]); return { src: v.picsSrc, has: await hasPictures(v.picsId, 1) }; })()")
    check('slide pictures present on A', pics['has'] and pics['src'] in ('google', 'pdf'), pics)

    # ---- device B through the setup link
    link = pa.evaluate("setupLink()")
    B = b.new_context(viewport={'width': 1280, 'height': 800})
    pb = B.new_page(); pb.on('pageerror', lambda e: errs.append('B: ' + str(e)))
    pb.goto(link); pb.wait_for_selector('.modal')
    pb.click('text=Turn on sync')
    wait(pb, "liveDecks().length >= 1", 30000)
    wait(pb, "App.queue.length === 0 && !Sync.qBusy", 60000)
    try: wait(pb, "(async () => await hasPictures(deckVer(liveDecks()[0]).picsId, 2))()", 1000)
    except Exception: pass
    for _ in range(40):
        if pb.evaluate("(async () => await hasPictures(deckVer(liveDecks()[0]).picsId, 2))()"): break
        time.sleep(0.5)
    bi = pb.evaluate("(async () => { const d = liveDecks()[0], v = deckVer(d); return { n: v.n, has: await hasPictures(v.picsId, 2), reqs: openRequests(d) }; })()")
    check('B gets the talk, version 2', bi['n'] == 2, bi)
    check('B downloads the pictures', bi['has'])
    check('B sees Claude list count', bi['reqs'] == 2, bi)

    # ---- Inbox: Claude drops v003 + appendix; only one device imports
    put('Lectern/Inbox', 'poct9_v002_60min_full.pptx', os.path.join(DECKS, 'poct9_v002_60min_full.pptx'))
    put('Lectern/Inbox', 'poct9_v001_60min_appendix.pptx', os.path.join(DECKS, 'poct9_v001_60min_appendix.pptx'))
    pa.evaluate("Sync.scanAt = 0; syncNow(false)"); pb.evaluate("Sync.scanAt = 0; syncNow(false)")
    wait(pa, "liveDecks().length >= 2 && App.queue.length === 0 && !Sync.qBusy", 120000)
    for _ in range(60):
        pb.evaluate("syncNow(false)"); time.sleep(1)
        if pb.evaluate("liveDecks().length") >= 2 and pb.evaluate("deckVer(liveDecks().find(d => d.role !== 'appendix')).n") >= 3: break
    ia = pa.evaluate("(() => { const ds = liveDecks(); const m = ds.find(d => d.role !== 'appendix'), a = ds.find(d => d.role === 'appendix'); return { n: deckVer(m).n, from: deckVer(m).from, decks: ds.length, mainId: a && a.mainId === m.id }; })()")
    ib = pb.evaluate("(() => ({ decks: liveDecks().length, n: deckVer(liveDecks().find(d => d.role !== 'appendix')).n, vers: [...App.versions.values()].length }))()")
    check('Inbox deck became version 3', ia['n'] == 3 and ia['from'] == 'inbox', ia)
    check('appendix attached to its main talk', ia['mainId'], ia)
    check('no double import from two devices', ib['decks'] == 2 and ib['vers'] == ia['n'] + 1, ib)
    st = state()
    check('Inbox emptied', not [f for f in st['files'] if f['folder'] == 'Lectern/Inbox' and not f['trashed']])

    # ---- edited in PowerPoint: master changes in Drive -> new version
    master = [f for f in st['files'] if f['folder'] == 'Lectern/Decks' and not f['trashed'] and 'Appendix' not in f['name']][0]
    req2 = urllib.request.Request(BASE + f"__put?replace={master['id']}", data=open(os.path.join(DECKS, 'poct9_v001_60min_full.pptx'), 'rb').read() + b'', method='POST')
    # make content differ from every stored version
    import shutil
    tmp = os.path.join(DECKS, 'edited.pptx'); shutil.copy(os.path.join(DECKS, 'poct9_v001_60min_full.pptx'), tmp)
    zin = zipfile.ZipFile(tmp); buf = io.BytesIO(); zout = zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED)
    for it in zin.infolist(): zout.writestr(it, zin.read(it.filename).replace(b'Four candidates', b'Four causes') if it.filename.endswith('slide2.xml') else zin.read(it.filename))
    zout.close()
    urllib.request.urlopen(urllib.request.Request(BASE + f"__put?replace={master['id']}", data=buf.getvalue(), method='POST'))
    pa.evaluate("Sync.scanAt = 0; syncNow(false)")
    wait(pa, "deckVer(liveDecks().find(d => d.role !== 'appendix')).n === 4 && App.queue.length === 0 && !Sync.qBusy", 120000)
    pe = pa.evaluate("(() => { const v = deckVer(liveDecks().find(d => d.role !== 'appendix')); return { from: v.from, t2: v.slides[1].title }; })()")
    check('PowerPoint edit became version 4', pe['from'] == 'powerpoint' and pe['t2'] == 'Four causes', pe)
    pa.evaluate("Sync.scanAt = 0; syncNow(false)"); time.sleep(3)
    check('no repeat import of the same edit', pa.evaluate("deckVer(liveDecks().find(d => d.role !== 'appendix')).n") == 4)

    # ---- a talk started in Claude's Talk Ideas project shows up from its status note, then its deck fills the card
    import tempfile
    sf = tempfile.NamedTemporaryFile('w', suffix='.md', delete=False)
    sf.write('talk: IMD detection\ndate: 2026-12-03\nlength: 45\naudience: Child CDC doctors\nstage: spine\nnotebook: https://notebooklm.google.com/notebook/abc\nnext: Approve the spine in the Talk Ideas chat\n'); sf.close()
    put('Lectern/Talks/IMD detection', 'status.md', sf.name)
    put('Lectern/Talks/IMD detection', 'spine.md', sf.name)
    pa.goto(BASE + '#/'); pa.evaluate("Sync.scanAt = 0; syncNow(false)")
    wait(pa, "liveDecks().some(d => d.think)", 30000)
    tk = pa.evaluate("(() => { const d = liveDecks().find(d => d.think); return { title: d.title, date: d.date, min: d.talkMin, next: pipeline(d).next.text, key: d.key }; })()")
    check('Claude status note makes a talk card', tk['title'] == 'IMD detection' and tk['date'] == '2026-12-03' and tk['min'] == 45, tk)
    check('card shows Claude next step', 'Approve the spine' in tk['next'], tk)
    pa.evaluate("go('#/d/' + liveDecks().find(d => d.think).id + '/1')"); pa.wait_for_selector('.think')
    check('think view lists notebook and spine', 'NotebookLM notebook' in pa.inner_text('.think') and 'Open notebook' in pa.inner_text('.think'))
    pa.keyboard.press('j'); pa.wait_for_selector('.modal textarea'); pa.fill('.modal textarea', 'open with the macro-TSH case'); pa.keyboard.press('Enter')
    wait(pa, "App.queue.length === 0 && !Sync.qBusy", 30000)
    st = state()
    qf = tempfile.NamedTemporaryFile('w', suffix='.md', delete=False); qf.write('# Likely questions\n\nQ: Is PEG precipitation reliable?\nA: As a screen, yes; confirm with gel filtration.\n\nQ: Who should test?\nOnly when results do not fit the patient.\n'); qf.close()
    put('Lectern/Talks/IMD detection', 'questions.md', qf.name)
    check('J jot reaches ideas.md', any(f['folder'] == 'Lectern/Talks/IMD detection' and f['name'] == 'ideas.md' for f in st['files']))
    put('Lectern/Inbox', tk['key'] + '_v001_45min_main.pptx', os.path.join(DECKS, 'newtalk_imd_v001_45min_main.pptx'))
    pa.evaluate("Sync.scanAt = 0; syncNow(false)")
    wait(pa, "liveDecks().find(d => d.think) && liveDecks().find(d => d.think).verId && App.queue.length === 0", 120000)
    pl = pa.evaluate("(() => { const d = liveDecks().find(d => d.think); return { title: d.title, n: deckVer(d).slides.length, count: liveDecks().length }; })()")
    pa.evaluate("practiseQuestions(liveDecks().find(d => d.think))"); pa.wait_for_selector('.qcard .qq')
    check('likely questions load for practice', 'PEG precipitation' in pa.inner_text('.qcard'))
    pa.keyboard.press(' '); time.sleep(0.2)
    check('Space shows the prepared answer', 'gel filtration' in pa.inner_text('.qcard'))
    pa.keyboard.press('Escape')
    check('Claude deck filled the talk card', pl['title'] == 'IMD detection' and pl['n'] == 6 and pl['count'] == 3, pl)

    # ---- present: speaker view + projector window in step
    did = pa.evaluate("liveDecks().find(d => d.role !== 'appendix' && !d.brief).id")
    pa.goto(BASE + f'#/d/{did}/1/present'); pa.wait_for_selector('.pchoice')
    with pa.expect_popup() as pop:
        pa.click('.pchoice >> nth=0')
    scr = pop.value; scr.wait_for_selector('.screen'); pa.wait_for_selector('.speaker')
    pa.keyboard.press('ArrowRight'); pa.keyboard.press('ArrowRight'); time.sleep(0.8)
    shown = scr.evaluate("document.querySelector('.screen img') ? document.querySelector('.screen img').alt : document.querySelector('.screen').innerText")
    check('projector follows the speaker, skipping the hidden slide', 'Slide 4' in shown, shown)
    scr.keyboard.press('ArrowRight'); time.sleep(0.8)
    check('clicker on projector moves the speaker', pa.inner_text('#spn b') == '5')
    pa.keyboard.press('b'); time.sleep(0.5)
    check('B blanks the projector', scr.evaluate("document.querySelector('.screen').classList.contains('black')"))
    pa.screenshot(path='/tmp/lectern-speaker.png')
    pa.click('.spbar >> text=End'); time.sleep(0.5)

    pa.goto(BASE + f'#/d/{did}/2'); pa.wait_for_selector('.stage'); time.sleep(1.5)
    pa.screenshot(path='/tmp/lectern-review.png')
    pa.keyboard.press('r'); time.sleep(0.8); pa.screenshot(path='/tmp/lectern-rehearse.png')
    pa.goto(BASE + '#/'); time.sleep(1.5); pa.screenshot(path='/tmp/lectern-library.png', full_page=True)
    check('no page errors', not errs, errs)
    b.close()

fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)} of {len(results)} checks passed')
sys.exit(1 if fails else 0)
