#!/usr/bin/env node
// A CLI that takes a prompt and prints text. No usage, no stream-json —
// stands in for a harness with no native driver.
const prompt = process.argv.slice(2).join(' ');
if (prompt.includes('Classify this ticket')) {
  console.log('Here is the classification you asked for:');
  console.log(JSON.stringify({
    class: 'feature', area: 'AUTH',
    reason: 'Behaviour has to be stated before it is built.',
    acceptance_criteria: [],
  }));
  console.log('Let me know if you want anything changed.');
} else {
  console.log('done');
}
