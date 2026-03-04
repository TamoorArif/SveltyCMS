#!/bin/bash
export TEST_MODE=true
export API_BASE_URL=http://127.0.0.1:4173

# Start server in background properly
nohup bun run preview --port 4173 --host 127.0.0.1 > preview.log 2>&1 &
SERVER_PID=$!

echo "Waiting for server to start..."
sleep 5
for i in {1..30}; do
  if curl -s http://127.0.0.1:4173/api/system/health > /dev/null; then
    echo "Server is up!"
    break
  fi
  sleep 1
done

TESTS="auth-2fa collections dashboard graphql import-export media miscellaneous rtc security settings setup-actions setup-utils system telemetry theme token user website-tokens widgets"

for test in $TESTS; do
  echo "--- Running $test.test.ts ---"
  # reset & seed between each file just to be safe, like the official runner does
  curl -s -X POST http://127.0.0.1:4173/api/testing -H "Content-Type: application/json" -d '{"action":"reset"}' > /dev/null
  curl -s -X POST http://127.0.0.1:4173/api/testing -H "Content-Type: application/json" -d '{"action":"seed"}' > /dev/null
  
  bun test tests/integration/api/${test}.test.ts
done

kill $SERVER_PID
