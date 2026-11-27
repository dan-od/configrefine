import { validatePull } from "./engine.js";

export async function runPullEraseFlow(pullResults, { backup, confirm, erase }) {
  if (!Object.keys(pullResults).length) return { validated: [], erased: [], cancelled: true };

  const validated = Object.entries(pullResults).map(([name, { config, expectedName }]) => {
    const v = validatePull(config, expectedName);
    return { name, config, expectedName, ...v };
  });

  await backup(Object.fromEntries(validated.map(d => [d.name, d.config])));

  const toErase = validated.filter(d => d.valid);
  if (!toErase.length) return { validated, erased: [], cancelled: false };

  const confirmed = await confirm(validated);
  if (!confirmed) return { validated, erased: [], cancelled: true };

  const erased = [];
  for (const d of toErase) {
    const result = await erase(d.name);
    erased.push({ name: d.name, ...result });
  }

  return { validated, erased, cancelled: false };
}
