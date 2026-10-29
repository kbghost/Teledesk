import type { Model, PipelineStage } from 'mongoose';

/**
 * Somme plusieurs métriques groupées par clé.
 * Une agrégation par métrique, exécutées en parallèle puis fusionnées : résultat identique sur MongoDB
 * et sur les moteurs compatibles qui n'appliquent qu'un seul accumulateur par $group (ex. FerretDB 1.x).
 * `spec` : nom de sortie → nom de champ à sommer, ou `1` pour compter.
 */
export async function groupSums<T = Record<string, number>>(
  model: Model<any>,
  match: Record<string, unknown>,
  groupBy: string,
  spec: Record<string, string | 1>,
  extra: PipelineStage[] = [],
): Promise<Array<{ _id: any } & T>> {
  const names = Object.keys(spec);
  const parts = await Promise.all(
    names.map((n) =>
      model.aggregate([
        { $match: match },
        { $group: { _id: groupBy, v: { $sum: spec[n] === 1 ? 1 : `$${spec[n]}` } } },
      ]),
    ),
  );
  const merged = new Map<string, any>();
  parts.forEach((rows, i) => {
    for (const r of rows as Array<{ _id: any; v: number }>) {
      const key = String(r._id);
      const cur = merged.get(key) ?? { _id: r._id, ...Object.fromEntries(names.map((n) => [n, 0])) };
      cur[names[i]!] = r.v;
      merged.set(key, cur);
    }
  });
  let out = [...merged.values()];
  for (const stage of extra) {
    if ('$sort' in stage) {
      const [[k, dir]] = Object.entries(stage.$sort as Record<string, 1 | -1>);
      out = out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
    } else if ('$limit' in stage) out = out.slice(0, stage.$limit as number);
  }
  return out as Array<{ _id: any } & T>;
}
