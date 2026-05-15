// ─────────────────────────────────────────────────────────────
// geo.ts — Funções geoespaciais server-side (Deno)
// Ponto-em-polígono + lookup de município + consulta SICAR WFS
// ─────────────────────────────────────────────────────────────

const MUNICIPIOS_URL =
  'https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-33-mun.json';

const SICAR_WFS =
  'https://geoserver.car.gov.br/geoserver/sicar/ows';

// Cache em memória (persiste enquanto a instância da Edge Function viver)
let _municipiosCache: GeoJSON.FeatureCollection | null = null;

// ── Tipos ──────────────────────────────────────────────────────
interface Municipio {
  nome: string;
  codigo: string;
  areaKm2: number;
}

interface ImovelCAR {
  codigo: string;
  area: string;
  situacao: string;
  tipo: string;
}

interface ConsultaResult {
  municipio: Municipio | null;
  imoveis: ImovelCAR[];
  temPlantas: boolean;
  linkPlantas: string;
}

// ── Ponto-em-polígono (ray casting) ───────────────────────────
function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function pointInFeature(lon: number, lat: number, feature: GeoJSON.Feature): boolean {
  const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  if (!geom) return false;
  if (geom.type === 'Polygon')
    return pointInRing(lon, lat, geom.coordinates[0] as number[][]);
  if (geom.type === 'MultiPolygon')
    return (geom.coordinates as number[][][][]).some(p =>
      pointInRing(lon, lat, p[0])
    );
  return false;
}

// ── Calcula área km² (fórmula excesso esférico) ───────────────
function calcAreaKm2(geometry: GeoJSON.Geometry): number {
  const RAD = Math.PI / 180, R = 6371;
  function ringArea(coords: number[][]): number {
    let a = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i], [lon2, lat2] = coords[i + 1];
      a += (lon2 - lon1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
    }
    return Math.abs(a * R * R / 2);
  }
  if (geometry.type === 'Polygon')
    return ringArea((geometry as GeoJSON.Polygon).coordinates[0] as number[][]);
  if (geometry.type === 'MultiPolygon')
    return ((geometry as GeoJSON.MultiPolygon).coordinates as number[][][][]).reduce(
      (s, p) => s + ringArea(p[0]), 0
    );
  return 0;
}

// ── Carrega municípios (com cache) ────────────────────────────
async function getMunicipios(): Promise<GeoJSON.FeatureCollection> {
  if (_municipiosCache) return _municipiosCache;
  const res = await fetch(MUNICIPIOS_URL);
  if (!res.ok) throw new Error(`Erro ao carregar municípios: ${res.status}`);
  const data = await res.json() as GeoJSON.FeatureCollection;
  // Normaliza propriedades para NM_MUN / CD_MUN
  for (const f of data.features) {
    const p = f.properties as Record<string, unknown>;
    if (!p.NM_MUN) p.NM_MUN = p.name || '';
    if (!p.CD_MUN) p.CD_MUN = p.id   || '';
    if (!p.AREA_KM2 || p.AREA_KM2 === 0)
      p.AREA_KM2 = calcAreaKm2(f.geometry!);
  }
  _municipiosCache = data;
  return data;
}

// ── Lookup de município por coordenada ────────────────────────
export async function findMunicipio(lat: number, lon: number): Promise<Municipio | null> {
  const fc = await getMunicipios();
  const found = fc.features.find(f => pointInFeature(lon, lat, f));
  if (!found) return null;
  const p = found.properties as Record<string, unknown>;
  return {
    nome:    String(p.NM_MUN  || p.name || 'Desconhecido'),
    codigo:  String(p.CD_MUN  || p.id   || ''),
    areaKm2: Number(p.AREA_KM2 || 0),
  };
}

// ── Consulta imóveis CAR por ponto (WFS — sem CORS server-side) ──
export async function findImoveisCAR(lat: number, lon: number): Promise<ImovelCAR[]> {
  // Buffer de ~500m ao redor do ponto
  const delta = 0.005;
  const bbox  = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

  const params = new URLSearchParams({
    service:     'WFS',
    version:     '2.0.0',
    request:     'GetFeature',
    typeName:    'sicar:sicar_imoveis_rj',
    outputFormat:'application/json',
    count:       '5',
    BBOX:        `${bbox},EPSG:4326`,
  });

  try {
    const res  = await fetch(`${SICAR_WFS}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as GeoJSON.FeatureCollection;
    return (data.features || []).map(f => {
      const p = f.properties as Record<string, unknown>;
      return {
        codigo:  String(p.cod_imovel   || '—'),
        area:    Number(p.area         || 0).toFixed(2) + ' ha',
        situacao:String(p.condicao     || '—'),
        tipo:    p.tipo_imovel === 'IRU' ? 'Imóvel Rural' : String(p.tipo_imovel || '—'),
      };
    });
  } catch {
    return [];
  }
}

// ── Busca plantas cadastradas (plantas.json do repo) ──────────
let _plantasCache: Record<string, { url?: string }> | null = null;
const PLANTAS_URL =
  'https://raw.githubusercontent.com/Agricart-JCA/jm-mapstudio/main/jm-saas/plantas.json';

async function getPlantas(): Promise<Record<string, { url?: string }>> {
  if (_plantasCache) return _plantasCache;
  try {
    const res = await fetch(PLANTAS_URL, { signal: AbortSignal.timeout(5000) });
    _plantasCache = res.ok ? await res.json() : {};
  } catch {
    _plantasCache = {};
  }
  return _plantasCache!;
}

// ── Consulta completa ─────────────────────────────────────────
export async function consultarCoordenada(lat: number, lon: number): Promise<ConsultaResult> {
  const [municipio, imoveis, plantas] = await Promise.all([
    findMunicipio(lat, lon),
    findImoveisCAR(lat, lon),
    getPlantas(),
  ]);

  const nomeM      = municipio?.nome || '';
  const entrada    = nomeM ? (plantas[nomeM] || null) : null;
  const linkPlantas = entrada?.url || '';

  return {
    municipio,
    imoveis,
    temPlantas: !!linkPlantas,
    linkPlantas,
  };
}
