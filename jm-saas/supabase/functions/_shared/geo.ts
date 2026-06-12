// ─────────────────────────────────────────────────────────────
// geo.ts — Funções geoespaciais server-side (Deno)
// Ponto-em-polígono + CAR/SICAR + Embargos IBAMA + INCRA
// ─────────────────────────────────────────────────────────────

const MUNICIPIOS_URL =
  'https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-33-mun.json';

const SICAR_WFS    = 'https://geoserver.car.gov.br/geoserver/sicar/ows';
const IBAMA_WFS    = 'https://siscom.ibama.gov.br/geoserver/geo_sas/ows';
const MAP_BASE_URL = 'https://jm-saas.vercel.app';
const SIGEF_URL    = 'https://jm-saas.vercel.app/sigef_rj.geojson';
const SUPABASE_URL = 'https://zzjizqiafnnuqmrkhjqj.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6aml6cWlhZm5udXFtcmtoanFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2Nzk3NDMsImV4cCI6MjA5NDI1NTc0M30.D0vhrJY2qgLJdqI8T75dgPer_376ICDOlvSoQVSoovk';

// Cache em memória (persiste entre invocações na mesma instância da Edge Function)
let _municipiosCache: GeoJSON.FeatureCollection | null = null;
let _sigefCache: GeoJSON.FeatureCollection | null = null;

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

export interface ParcelaSIGEF {
  codigo: string;      // UUID SIGEF
  imovel: string;      // código do imóvel (13 díg.)
  nome: string;        // nome da área
  status: string;      // CERTIFICADA
  situacao: string;    // REGISTRADA etc.
  matricula: string;
  area: string;        // calculada
  municipio: string;   // código IBGE
  centroide?: { lat: number; lon: number };
}

export interface PlantaPAL {
  titulo: string;
  tipo: string;
  bairro: string;
  data: string;
  url: string;
}

export interface ConsultaResult {
  municipio: Municipio | null;
  imoveis: ImovelCAR[];
  sigef: ParcelaSIGEF[];
  embargos: EmbargoIBAMA[];
  plantas: PlantaPAL[];
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

// ── SIGEF / INCRA (base local hospedada no Vercel) ────────────
async function getSigef(): Promise<GeoJSON.FeatureCollection> {
  if (_sigefCache) return _sigefCache;
  const res = await fetch(SIGEF_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Erro ao carregar SIGEF: ${res.status}`);
  _sigefCache = await res.json() as GeoJSON.FeatureCollection;
  return _sigefCache;
}

function centroidOf(geom: GeoJSON.Geometry): { lat: number; lon: number } | undefined {
  const bbox = bboxOfGeometry(geom);
  return bbox ? { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 } : undefined;
}

function parcelaFromFeature(f: GeoJSON.Feature): ParcelaSIGEF {
  const p = (f.properties || {}) as Record<string, unknown>;
  const areaHa = f.geometry ? (calcAreaKm2(f.geometry) * 100) : 0; // km² → ha
  return {
    codigo:    String(p.codigo || p.parcela_codigo || '—'),
    imovel:    String(p.imovel || ''),
    nome:      String(p.nome || ''),
    status:    String(p.status || 'CERTIFICADA'),
    situacao:  String(p.situacao || ''),
    matricula: String(p.matricula || ''),
    area:      areaHa.toFixed(2) + ' ha',
    municipio: String(p.municipio || ''),
    centroide: f.geometry ? centroidOf(f.geometry) : undefined,
  };
}

export async function findParcelasSIGEF(lat: number, lon: number): Promise<ParcelaSIGEF[]> {
  try {
    const fc = await getSigef();
    return fc.features.filter(f => pointInFeature(lon, lat, f)).map(parcelaFromFeature);
  } catch (e) {
    console.error('[SIGEF] erro:', e);
    return [];
  }
}

// Busca por UUID SIGEF, código do imóvel (13 díg.) ou matrícula
export async function buscarSIGEF(termo: string): Promise<ParcelaSIGEF | null> {
  const t = termo.toUpperCase().replace(/[\s.\-]/g, '');
  try {
    const fc = await getSigef();
    const f = fc.features.find(x => {
      const p = (x.properties || {}) as Record<string, unknown>;
      return [p.codigo, p.parcela_codigo, p.imovel, p.matricula]
        .some(c => c && String(c).toUpperCase().replace(/[\s.\-]/g, '') === t);
    });
    return f ? parcelaFromFeature(f) : null;
  } catch {
    return null;
  }
}

// ── Plantas PAL (biblioteca colaborativa — tabela Supabase) ───
export async function findPlantasMunicipio(municipio: string): Promise<PlantaPAL[]> {
  if (!municipio) return [];
  try {
    const url = `${SUPABASE_URL}/rest/v1/plantas?municipio=ilike.${encodeURIComponent(municipio)}` +
                `&status=eq.aprovado&order=created_at.desc&limit=10` +
                `&select=titulo,tipo,bairro,data_aproximada,pdf_url`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const rows = await res.json() as Record<string, unknown>[];
    return rows.map(r => ({
      titulo: String(r.titulo || 'Planta'),
      tipo:   String(r.tipo || 'planta'),
      bairro: String(r.bairro || ''),
      data:   String(r.data_aproximada || ''),
      url:    String(r.pdf_url || ''),
    })).filter(p => p.url);
  } catch {
    return [];
  }
}

// ── Consulta completa por coordenada (CAR + SIGEF + plantas + embargos) ──
export async function consultarCoordenada(lat: number, lon: number): Promise<ConsultaResult> {
  const municipio = await findMunicipio(lat, lon);
  const [imoveis, sigef, embargos, plantas] = await Promise.all([
    findImoveisCAR(lat, lon),
    findParcelasSIGEF(lat, lon),
    findEmbargosIBAMA(lat, lon),
    findPlantasMunicipio(municipio?.nome || ''),
  ]);

  const linkPlantas = plantas[0]?.url || '';
  const linkMapa    = `${MAP_BASE_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;

  return {
    municipio, imoveis, sigef, embargos, plantas,
    temPlantas: plantas.length > 0, linkPlantas, linkMapa,
  };
}

// ── Busca imóvel CAR por código ───────────────────────────────
export async function buscarPorCodigoCAR(codigo: string): Promise<{
  encontrado: boolean;
  imovel?: ImovelCAR;
  centroide?: { lat: number; lon: number };
}> {
  const codigoClean = codigo.replace(/\s/g, '').toUpperCase();
  // Valida formato estrito para evitar CQL injection
  const RE_CAR = /^[A-Z]{2}-\d{7}-[A-Z0-9]{12,50}$/;
  if (!RE_CAR.test(codigoClean)) throw new Error('Código CAR inválido');
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
