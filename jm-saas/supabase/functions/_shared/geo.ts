// ─────────────────────────────────────────────────────────────
// geo.ts — Funções geoespaciais server-side (Deno)
// Ponto-em-polígono + CAR/SICAR + Embargos IBAMA + INCRA
// ─────────────────────────────────────────────────────────────

const MUNICIPIOS_URL =
  'https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-33-mun.json';

const SICAR_WFS    = 'https://geoserver.car.gov.br/geoserver/sicar/ows';
const IBAMA_WFS    = 'https://siscom.ibama.gov.br/geoserver/geo_sas/ows';
const MAP_BASE_URL = 'https://agricart-jca.github.io/jm-mapstudio';

// Cache em memória
let _municipiosCache: GeoJSON.FeatureCollection | null = null;

// ── Tipos ──────────────────────────────────────────────────────
export interface Municipio {
  nome: string;
  codigo: string;
  areaKm2: number;
  uf: string;
}

export interface ImovelCAR {
  codigo: string;
  area: string;
  situacao: string;
  tipo: string;
}

export interface EmbargoIBAMA {
  numTai: string;
  area: string;
  situacao: string;
  dataEmissao: string;
}

export interface ConsultaResult {
  municipio: Municipio | null;
  imoveis: ImovelCAR[];
  embargos: EmbargoIBAMA[];
  temPlantas: boolean;
  linkPlantas: string;
  linkMapa: string;
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

// ── Calcula área km² ──────────────────────────────────────────
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
  const res = await fetch(MUNICIPIOS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Erro ao carregar municípios: ${res.status}`);
  const data = await res.json() as GeoJSON.FeatureCollection;
  for (const f of data.features) {
    const p = f.properties as Record<string, unknown>;
    if (!p.NM_MUN) p.NM_MUN = p.name || '';
    if (!p.CD_MUN) p.CD_MUN = p.id   || '';
    if (!p.UF)     p.UF     = 'RJ';
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
    uf:      String(p.UF || 'RJ'),
  };
}

// ── Bbox a partir de ponto + raio em metros ───────────────────
function bboxFromPoint(lat: number, lon: number, raioM = 500): string {
  const dLat = raioM / 111320;
  const dLon = raioM / (111320 * Math.cos(lat * Math.PI / 180));
  return `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
}

// ── Consulta imóveis CAR (WFS SICAR) ─────────────────────────
export async function findImoveisCAR(lat: number, lon: number): Promise<ImovelCAR[]> {
  const bbox = bboxFromPoint(lat, lon, 500);
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeName: 'sicar:sicar_imoveis_rj', outputFormat: 'application/json',
    count: '5', BBOX: `${bbox},EPSG:4326`,
  });
  try {
    const res  = await fetch(`${SICAR_WFS}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as GeoJSON.FeatureCollection;
    return (data.features || []).map(f => {
      const p = f.properties as Record<string, unknown>;
      const sit = String(p.condicao || p.situacao || '—').toLowerCase();
      const sitLabel =
        sit.includes('certif') ? '✅ Certificado' :
        sit.includes('cancel') ? '❌ Cancelado'   :
        sit.includes('pend')   ? '⏳ Pendente'    : `📋 ${sit}`;
      return {
        codigo:  String(p.cod_imovel || '—'),
        area:    Number(p.area_imovel || p.area || 0).toFixed(2) + ' ha',
        situacao: sitLabel,
        tipo:    p.tipo_imovel === 'IRU' ? 'Imóvel Rural' :
                 p.tipo_imovel === 'AST' ? 'Assentamento' :
                 String(p.tipo_imovel || '—'),
      };
    });
  } catch {
    return [];
  }
}

// ── Consulta embargos IBAMA (WFS siscom) ──────────────────────
export async function findEmbargosIBAMA(lat: number, lon: number): Promise<EmbargoIBAMA[]> {
  const bbox = bboxFromPoint(lat, lon, 1000);
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeName: 'geo_sas:areas_embargadas', outputFormat: 'application/json',
    count: '5', BBOX: `${bbox},EPSG:4326`,
  });
  try {
    const res  = await fetch(`${IBAMA_WFS}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as GeoJSON.FeatureCollection;
    return (data.features || []).map(f => {
      const p = f.properties as Record<string, unknown>;
      return {
        numTai:      String(p.num_tai      || p.numtai     || '—'),
        area:        Number(p.area_ha      || 0).toFixed(2) + ' ha',
        situacao:    String(p.situacao     || p.des_situac || '—'),
        dataEmissao: String(p.dat_emissao  || p.data       || '—').slice(0, 10),
      };
    });
  } catch {
    return [];
  }
}

// ── Plantas cadastradas ───────────────────────────────────────
let _plantasCache: Record<string, { url?: string }> | null = null;
const PLANTAS_URL =
  'https://raw.githubusercontent.com/Agricart-JCA/jm-mapstudio/main/jm-saas/plantas.json';

async function getPlantas(): Promise<Record<string, { url?: string }>> {
  if (_plantasCache) return _plantasCache;
  try {
    const res = await fetch(PLANTAS_URL, { signal: AbortSignal.timeout(5000) });
    _plantasCache = res.ok ? await res.json() : {};
  } catch { _plantasCache = {}; }
  return _plantasCache!;
}

// ── Consulta completa por coordenada ──────────────────────────
export async function consultarCoordenada(lat: number, lon: number): Promise<ConsultaResult> {
  const [municipio, imoveis, embargos, plantas] = await Promise.all([
    findMunicipio(lat, lon),
    findImoveisCAR(lat, lon),
    findEmbargosIBAMA(lat, lon),
    getPlantas(),
  ]);

  const nomeM       = municipio?.nome || '';
  const entrada     = nomeM ? (plantas[nomeM] || null) : null;
  const linkPlantas = entrada?.url || '';
  const linkMapa    = `${MAP_BASE_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;

  return { municipio, imoveis, embargos, temPlantas: !!linkPlantas, linkPlantas, linkMapa };
}

// ── Busca imóvel CAR por código ───────────────────────────────
export async function buscarPorCodigoCAR(codigo: string): Promise<{
  encontrado: boolean;
  imovel?: ImovelCAR;
  centroide?: { lat: number; lon: number };
}> {
  const codigoClean = codigo.replace(/\s/g, '').toUpperCase();
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature',
    typeName: 'sicar:sicar_imoveis_rj', outputFormat: 'application/json',
    count: '1',
    CQL_FILTER: `cod_imovel='${codigoClean}'`,
  });
  try {
    const res  = await fetch(`${SICAR_WFS}?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { encontrado: false };
    const data = await res.json() as GeoJSON.FeatureCollection;
    if (!data.features?.length) return { encontrado: false };
    const f = data.features[0];
    const p = f.properties as Record<string, unknown>;

    // Calcula centróide da bbox
    let centroide: { lat: number; lon: number } | undefined;
    if (f.geometry) {
      const bbox = bboxOfGeometry(f.geometry as GeoJSON.Geometry);
      if (bbox) centroide = { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 };
    }

    const sit = String(p.condicao || p.situacao || '').toLowerCase();
    return {
      encontrado: true,
      imovel: {
        codigo:  String(p.cod_imovel || codigoClean),
        area:    Number(p.area_imovel || p.area || 0).toFixed(2) + ' ha',
        situacao: sit.includes('certif') ? '✅ Certificado' :
                  sit.includes('cancel') ? '❌ Cancelado'   :
                  sit.includes('pend')   ? '⏳ Pendente'    : '📋 ' + sit,
        tipo:    p.tipo_imovel === 'IRU' ? 'Imóvel Rural' : String(p.tipo_imovel || '—'),
      },
      centroide,
    };
  } catch {
    return { encontrado: false };
  }
}

function bboxOfGeometry(geom: GeoJSON.Geometry): [number,number,number,number] | null {
  const coords: number[][] = [];
  function collect(g: GeoJSON.Geometry) {
    if (g.type === 'Point') coords.push(g.coordinates as number[]);
    else if (g.type === 'LineString' || g.type === 'MultiPoint')
      (g.coordinates as number[][]).forEach(c => coords.push(c));
    else if (g.type === 'Polygon' || g.type === 'MultiLineString')
      (g.coordinates as number[][][]).forEach(r => r.forEach(c => coords.push(c)));
    else if (g.type === 'MultiPolygon')
      (g.coordinates as number[][][][]).forEach(p => p.forEach(r => r.forEach(c => coords.push(c))));
  }
  collect(geom);
  if (!coords.length) return null;
  const lons = coords.map(c => c[0]), lats = coords.map(c => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}
