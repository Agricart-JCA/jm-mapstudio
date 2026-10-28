# Roadmap — "clonar" o Dados Fazenda (pós-lançamento)

> Status: **PLANEJAMENTO.** Nenhum código entra antes de fechar as Tarefas 1–4 (segurança,
> Stripe, LGPD, termos) e lançar. Documento de referência, não de execução.

## Leitura estratégica

Dados Fazenda **não é o mesmo produto** que o MapStudio — é um vizinho de outro segmento:

- **MapStudio = ferramenta de PRODUÇÃO pro agrimensor/engenheiro.** Gera entregável:
  memorial, planta A3, relatório, SIGEF, cotagem. O Dados Fazenda não faz nada disso.
- **Dados Fazenda = inteligência/monitoramento de risco pro AGRONEGÓCIO.** Vende pra
  produtor, trading, banco, advogado ambiental. Valor = agregar dado (122 bases) +
  monitorar (alerta de embargo/queimada no WhatsApp).

"Clonar completo" = entrar num segundo mercado. Viável e com sinergia (ambos partem de
CAR + localização), mas é um produto a mais, não uma feature. Já temos metade do esqueleto
(CAR nacional, satélite, desenho de perímetro, bot WhatsApp construído) e uma arma que eles
**não têm**: a entrega de engenharia.

## Preços do concorrente (validação de mercado)

- Free: CAR, KML, 1 FarmScan PDF, 5 imagens de satélite/mês
- **Pro: R$ 99,90/mês** (anual R$ 1.198,80) — 44 camadas, FarmScans ilimitados, alertas WhatsApp
- **Empresarial: R$ 497/mês** — 2 acessos Pro, gestão de time, extra R$ 149/user

Valida o plano Profissional R$ 119 (Tarefa 2) e mostra que o módulo de inteligência fundiária
é o que justifica os planos de cima.

## Mapa de lacunas

| Capacidade | MapStudio | Dados Fazenda |
|---|---|---|
| Mapa + satélite + desenho de perímetro | ✅ | ✅ |
| CAR nacional (clique/GPS/código) | ✅ | ✅ |
| SIGEF | ✅ só RJ | ✅ nacional |
| **Memorial / planta A3 / relatório de engenharia** | ✅ **(só nós)** | ❌ |
| Bot WhatsApp de consulta | 🟡 construído, não publicado | ✅ canal principal |
| Camadas de risco (embargos IBAMA, PRODES/DETER, ICMBio, FUNAI, queimadas INPE) | ❌ | ✅ |
| Monitoramento + alerta automático | ❌ | ✅ |
| NDVI / saúde da vegetação (série temporal) | ❌ | ✅ |
| Solo, chuva, aptidão agrícola (Embrapa/CONAB) | ❌ | ✅ |
| Visão 3D da propriedade | 🟡 base de MDT/volumetria | ✅ |
| Relatório consolidado "FarmScan" (raio-x PDF) | ❌ (≠ memorial) | ✅ |
| Emissão de certidões (CCIR, recibo CAR…) | ❌ | ✅ |
| Freemium + 122 bases agregadas | ❌ | ✅ |

## Roadmap em fases (esforço crescente)

**Fase 1 — Consulta nacional + camadas de risco** · *reaproveita muito, custo baixo*
SIGEF nacional (generalizar o que já fiz pro RJ, por UF) + camadas ambientais federais
(embargos IBAMA, PRODES/DETER, UC ICMBio, TI FUNAI, focos INPE) como overlays + sobreposição
automática na ficha do imóvel. **É a Tarefa 6 (cache de dados gov) generalizada — mesma infra.**

**Fase 2 — Ficha/relatório consolidado + WhatsApp** · *médio, reaproveita o bot*
PDF "raio-x da propriedade" (área, CAR, sobreposições ambientais, satélite) — diferente do
memorial — + deploy do bot WhatsApp (já construído) entregando a ficha. Freemium: consulta
básica grátis → ficha completa no pago.

**Fase 3 — Agronômico + satélite temporal** · *lift grande, precisa de Google Earth Engine*
NDVI série temporal (Sentinel-2 via GEE), solo (SoilGrids/Embrapa), chuva, aptidão, visão 3D
(reusa o MDT). Custo recorrente de processamento entra aqui.

**Fase 4 — Monitoramento + alertas** · *o motor mais caro*
Cadastro de fazendas monitoradas + cron que detecta novo embargo/queimada e dispara alerta no
WhatsApp + relatório mensal automático. É o que fideliza e justifica mensalidade.

**Fase 5 — Certidões, comparador de insumos, time empresarial** · nicho, por último.

## Recomendação

Não disputar volume de dados no dia 1 (122 bases + monitoramento é anos de infra). Fazer
**Fase 1+2**: entrega "consulta nacional + ficha + WhatsApp" (~80% do valor percebido com ~20%
do esforço, reusando o que já existe) **mantendo o diferencial que eles não têm — gerar memorial
e planta da mesma consulta.** Posicionamento: *"consulta como o Dados Fazenda + a entrega técnica
que eles não fazem."*
