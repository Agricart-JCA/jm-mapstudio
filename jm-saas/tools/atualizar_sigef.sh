#!/bin/bash
# Atualização mensal da base SIGEF RJ do JM MapStudio
# Uso: bash tools/atualizar_sigef.sh   (rodar de dentro de jm-saas/)
# Baixa as parcelas certificadas do RJ direto do WFS do INCRA (i3geo),
# converte para GeoJSON otimizado e deixa pronto para commit + deploy.
set -e
cd "$(dirname "$0")/.."

echo "1/3 Baixando parcelas SIGEF particulares RJ (WFS INCRA)..."
curl -s "https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=certificada_sigef_particular_rj&service=WFS&version=1.0.0&request=GetFeature&typename=certificada_sigef_particular_rj" \
  --max-time 300 -o /tmp/sigef_part_rj.xml
echo "   $(du -h /tmp/sigef_part_rj.xml | cut -f1) baixados"

echo "2/3 Convertendo GML -> GeoJSON otimizado..."
node tools/converter_sigef.js /tmp/sigef_part_rj.xml sigef_rj.geojson

echo "3/3 Pronto! Agora:"
echo "   git add sigef_rj.geojson && git commit -m 'data: atualiza base SIGEF RJ' && npx vercel --prod"
