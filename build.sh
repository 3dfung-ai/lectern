#!/bin/sh
# Assemble app.js from src/ and stamp the offline cache with a build id.
set -e
cd "$(dirname "$0")"
cat src/*.js > app.js
BUILD=$(cat app.js index.html tts-worker.js mp3-worker.js lectern-sync.gs | sha1sum | cut -c1-8)
sed -i "s/const CACHE = 'lectern-[^']*';/const CACHE = 'lectern-$BUILD';/" sw.js
node --check app.js && echo "app.js OK ($BUILD)"
