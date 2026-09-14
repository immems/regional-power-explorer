// Read-only tools over the pre-aggregated JSON already
// served from /public/data. Deliberately thin — no GeoJSON is ever read here,
// so nothing large can reach the model's context.
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const cache = new Map();
/** Memoised fetch; resolves `undefined` on 404 so tools say "not available" instead of throwing. */
const getJson = url => {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => (r.ok ? r.json() : undefined)).catch(() => undefined));
  return cache.get(url);
};
const json = o => ({ content: [{ type: 'text', text: JSON.stringify(o) }] });
const iso3 = z.string().length(3).transform(s => s.toUpperCase()).describe('ISO3 country code, e.g. TUR');
const last = arr => arr?.at(-1);

export function buildDataServer() {
  const server = new McpServer({ name: 'data', version: '0.0.0' });

  server.tool('regions', 'List the power pools/regions in this explorer with their member countries (ISO3 + name). Call this first to resolve names to ids/codes.', {}, async () => {
    const { regions = [] } = (await getJson('/data/regions.json')) ?? {};
    return json(regions.map(({ id, name, status, countries }) => ({ id, name, status, countries })));
  });

  server.tool('capacity', 'Installed capacity (MW) by fuel per country in a region, plus average plant age (GPPD). Source is the selected plant dataset.', {
    regionId: z.string().describe('region id from `regions`, e.g. wapp'),
    source: z.enum(['osm', 'gem', 'gppd']).default('gem'),
  }, async ({ regionId, source }) => {
    const suffix = source === 'osm' ? '' : `_${source}`;
    const [cap, age] = await Promise.all([
      getJson(`/data/cache/region_capacity_${regionId}${suffix}.json`),
      getJson(`/data/cache/region_age_${regionId}_gppd.json`),
    ]);
    if (!cap) return json({ error: `No ${source} capacity file for region "${regionId}".` });
    return json({ unit: 'MW', source, countries: cap.countries, age: age && { referenceYear: age.reference_year, unit: 'years', countries: age.countries } });
  });

  server.tool('supply', 'Generation (GWh) and capacity (MW) by fuel for one country: latest year values, plus a short trend of totals. Cites the file\'s own source string.', { iso: iso3 }, async ({ iso }) => {
    const d = await getJson(`/data/supply/${iso}.json`);
    if (!d) return json({ error: `This explorer has no supply file for ${iso}.` });
    const summarise = block => block && {
      source: block.source, unit: block.unit, note: block.note,
      latestYear: last(block.years),
      latestByFuel: Object.fromEntries(Object.entries(block.fuels ?? {}).map(([f, s]) => [f, last(s)])),
      totalByYear: Object.fromEntries(block.years.map((y, i) => [y, Object.values(block.fuels ?? {}).reduce((a, s) => a + (s[i] ?? 0), 0)])),
      demand: block.demand ? Object.fromEntries(block.years.map((y, i) => [y, block.demand[i]])) : undefined,
      peakDemand: block.peak_demand ? Object.fromEntries(block.years.map((y, i) => [y, block.peak_demand[i]])) : undefined,
    };
    return json({ country: d.country, generation: summarise(d.generation), capacity: summarise(d.capacity) });
  });

  server.tool('trade', 'Electricity imports/exports (GWh) for one country: net position by year and top partners in the latest year.', { iso: iso3, topN: z.number().int().min(1).max(15).default(8) }, async ({ iso, topN }) => {
    const d = await getJson(`/data/trade/${iso}.json`);
    if (!d) return json({ error: `This explorer has no trade file for ${iso}.` });
    const sum = m => d.years.map((_, i) => Object.values(m).reduce((a, s) => a + (s[i] ?? 0), 0));
    const imp = sum(d.imports), exp = sum(d.exports);
    const top = m => Object.entries(m).map(([p, s]) => [p, last(s)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, topN);
    return json({
      country: d.country, source: d.source, unit: d.unit, latestYear: last(d.years),
      netImportsByYear: Object.fromEntries(d.years.map((y, i) => [y, +(imp[i] - exp[i]).toFixed(1)])),
      latestTopImportPartners: Object.fromEntries(top(d.imports)),
      latestTopExportPartners: Object.fromEntries(top(d.exports)),
    });
  });

  server.tool('indicators', 'Electricity access (% total/urban/rural) and retail tariffs (USD/kWh residential/industrial) for up to 30 countries.', { isos: z.array(iso3).max(30) }, async ({ isos }) => {
    const [access, tariffs] = await Promise.all([getJson('/data/access.json'), getJson('/data/tariffs.json')]);
    return json({
      access: { year: access?.year, unit: '% of population' }, tariffs: { year: tariffs?.year, unit: 'USD/kWh' },
      countries: Object.fromEntries(isos.map(c => [c, { access: access?.countries?.[c], tariffs: tariffs?.countries?.[c] }])),
    });
  });

  return server;
}
