/* ============ step 0, Think: what Claude and you have done so far (read-only, no forms) ============ */
function thinkView(d) {
  const t = d.think || {};
  const item = (ok, part, text, extra) => h('li', { class: ok ? 'got' : part ? 'part' : 'miss' }, h('span', { class: 'tk', text: ok ? '✓' : part ? '◐' : '○' }), h('span', {}, text), extra || null);
  const spineBox = h('div', { class: 'spine' }, h('p', { class: 'mut', text: t.spine ? 'Loading the spine…' : 'No spine yet. Claude writes it with you in 1 Talk Ideas.' }));
  if (t.spine && syncReady()) call({ op: 'readText', which: 'spine', name: t.folder }).then(r => {
    spineBox.replaceChildren(...(r.text || '').split('\n').filter(l => l.trim()).map(l => /^#{1,3}\s/.test(l) ? h('h4', { text: l.replace(/^#+\s*/, '') }) : /^\s*[-*]\s/.test(l) ? h('p', { class: 'li', text: '• ' + l.replace(/^\s*[-*]\s*/, '') }) : h('p', { text: l })));
  }).catch(() => spineBox.replaceChildren(h('p', { class: 'mut', text: 'The spine is in Drive › Lectern › Talks › ' + t.folder + ' › spine.md.' })));
  return h('div', { class: 'think' },
    h('div', { class: 'pcol' },
      h('h2', { text: 'Thinking it through' }),
      h('p', { class: 'lead', text: 'This happens in Claude’s 1 Talk Ideas project. Lectern shows where it has got to; nothing to fill in here.' }),
      h('ul', { class: 'tchecks' },
        item(t.pack > 0, false, t.pack ? `Talk pack: ${t.pack} PDFs` : 'Talk pack of PDFs', t.packId ? h('a', { class: 'btn quiet small', href: `https://drive.google.com/drive/folders/${t.packId}`, target: '_blank', rel: 'noopener' }, 'Open in Drive') : null),
        item(!!t.notebook, false, 'NotebookLM notebook', t.notebook ? h('a', { class: 'btn quiet small', href: t.notebook, target: '_blank', rel: 'noopener' }, 'Open notebook') : null),
        item(t.spineApproved, t.spine, t.spineApproved ? 'Spine approved' : t.spine ? 'Spine drafted, not approved yet' : 'One-page spine'),
        item(!!deckVer(d), t.stage === 'building', deckVer(d) ? 'Deck built' : t.stage === 'building' ? 'Claude is building the deck' : 'Deck')),
      h('div', { class: 'callout' }, h('p', { text: t.next || 'Carry on in this talk’s chat in 1 Talk Ideas.' }), btn('Continue in Claude', { primary: true, onclick: () => copyContinue(d) })),
      h('p', { class: 'hint' }, 'Had an idea? Press ', h('kbd', { text: 'J' }), ' anywhere in Lectern, or ', h('button', { type: 'button', class: 'link', onclick: () => jotIdea(d) }, 'jot it now'), '.')),
    h('div', { class: 'pcol side' }, h('section', { class: 'psrc' }, h('h3', { text: 'The spine' }), spineBox)));
}
