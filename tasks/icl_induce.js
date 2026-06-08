#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Resolve project root
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load settings and model map
import settings from '../settings.js';
import { selectAPI, createModel } from '../src/models/_model_map.js';

function loadProfile() {
  if (!settings.profiles || settings.profiles.length === 0) {
    throw new Error('No profiles configured in settings.js');
  }
  const fp = path.isAbsolute(settings.profiles[0])
    ? settings.profiles[0]
    : path.join(PROJECT_ROOT, settings.profiles[0]);
  const raw = fs.readFileSync(fp, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const args = yargs(hideBin(process.argv))
    .option('prompt_file', { type: 'string', demandOption: true })
    .option('out', { type: 'string', demandOption: true })
    .help().argv;

  const promptPath = path.isAbsolute(args.prompt_file)
    ? args.prompt_file
    : path.join(PROJECT_ROOT, args.prompt_file);
  const outPath = path.isAbsolute(args.out)
    ? args.out
    : path.join(PROJECT_ROOT, args.out);

  const promptText = fs.readFileSync(promptPath, 'utf8');

  // Build chat model from profile.model
  const profile = loadProfile();
  const chatProfile = selectAPI(profile.model);
  const chatModel = createModel(chatProfile);

  // Use prompt as system instruction, empty turns
  console.log('[ICL] Calling LLM to induce action sequence...');
  const response = await chatModel.sendRequest([], promptText);
  console.log('[ICL] LLM response received.');

  // Try to extract JSON
  let text = (response || '').trim();
  if (text.startsWith('```')) {
    const lines = text.split('\n');
    text = lines.slice(1, -1).join('\n');
    text = text.replace(/^json\s*/i, '');
  }

  // Find JSON braces window if extra text exists
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let parsed = null;
  if (start !== -1 && end !== -1 && end > start) {
    const jsonStr = text.slice(start, end + 1);
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // fallback to raw text
    }
  }

  const outObj = parsed || { raw: response };
  fs.writeFileSync(outPath, JSON.stringify(outObj, null, 2), 'utf8');
  console.log('[ICL] Saved induced action sequence to', outPath);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});


