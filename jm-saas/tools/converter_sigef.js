// Conversor GML (WFS i3geo/INCRA) → GeoJSON otimizado para o JM MapStudio
// Uso: node tools/converter_sigef.js <entrada.xml> <saida.geojson>
// Atualização mensal: baixar o GML novo e rodar de novo (ver tools/atualizar_sigef.sh)
const fs = require('fs');

const [,, entrada, saida] = process.argv;
if (!entrada || !saida) { console.error('Uso: node converter_sigef.js entrada.xml saida.geojson'); process.exit(1); }

const xml = fs.readFileSync(entrada, 'utf8');
const membros = xml.split('<gml:featureMember>').slice(1);
console.log('featureMembers encontrados:', membros.length);

const pega = (s, tag) => {
  const m = s.match(new RegExp(`<ms:${tag}>([^<]*)</ms:${tag}>`));
  return m ? m[1].trim() : '';
};

// Converte "lon,lat lon,lat ..." em anel [[lon,lat],...] com 6 casas
function parseCoords(str) {
  return str.trim().split(/\s+/).map(par => {
    const [x, y] = par.split(',').map(Number);
    return [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];
  }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
}

const feats = [];
let semGeom = 0;
for (const m of membros) {
  // Anéis externos (cada outerBoundary é um polígono; MultiPolygon = vários)
  // Tags podem ter atributos (ex.: <gml:Polygon srsName="EPSG:4326">) → regex tolerante
  const polys = [];
  const polyBlocks = m.split(/<gml:Polygon[^>]*>/).slice(1);
  for (const pb of polyBlocks) {
    const outer = pb.match(/<gml:outerBoundaryIs[^>]*>[\s\S]*?<gml:coordinates[^>]*>([\s\S]*?)<\/gml:coordinates>/);
    if (!outer) continue;
    const rings = [parseCoords(outer[1])];
    // anéis internos (furos)
    const inners = [...pb.matchAll(/<gml:innerBoundaryIs[^>]*>[\s\S]*?<gml:coordinates[^>]*>([\s\S]*?)<\/gml:coordinates>/g)];
    for (const inn of inners) rings.push(parseCoords(inn[1]));
    if (rings[0].length >= 4) polys.push(rings);
  }
  if (!polys.length) { semGeom++; continue; }

  const geometry = polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };

  feats.push({
    type: 'Feature',
    geometry,
    properties: {
      codigo:    pega(m, 'parcela_codigo'),       // UUID SIGEF
      imovel:    pega(m, 'codigo_imovel'),        // código do imóvel (13 dígitos)
      nome:      pega(m, 'nome_area'),
      status:    pega(m, 'status'),               // CERTIFICADA
      situacao:  pega(m, 'situacao_informada'),   // REGISTRADA etc.
      matricula: pega(m, 'registro_matricula'),
      municipio: pega(m, 'codigo_municipio'),     // IBGE
      aprovacao: pega(m, 'data_aprovacao'),
      rt:        pega(m, 'rt'),
      art:       pega(m, 'art'),
    }
  });
}

const fc = { type: 'FeatureCollection', features: feats };
fs.writeFileSync(saida, JSON.stringify(fc));
const mb = (fs.statSync(saida).size / 1048576).toFixed(1);
console.log(`OK: ${feats.length} parcelas (${semGeom} sem geometria) → ${saida} (${mb} MB)`);
