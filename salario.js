/* ============================================================
   Orizon — salario.js  (v2.5)
   "Salário e descontos" dentro de cada mês (aba Mês, parte de baixo):
   · Quantos salários quiser por mês ("＋ Adicionar outro salário"). Cada um tem um painel
     flutuante com o mesmo cálculo da planilha: bruto + trienio − faltas/DSR
     + extras + produção → INSS em 2 faixas → TOTAL LÍQUIDO → passagem.
   · O líquido salvo aparece em "Renda mensal" lá em cima, TRAVADO
     (só se edita aqui embaixo). A passagem NÃO sobe: fica só aqui.
   · Calendário da passagem: livre (qualquer mês/ano), "Marcar 5 → 5",
     toque marca o dia e, no dia marcado, paga IDA e/ou VOLTA; azul = a usar, vermelho = passou e falta
     pagar, verde = pago; feriados só são informados (você decide);
     subconta com total / pago / atrasado / a pagar.
   Tudo fica em estado.meses[m].salarios (entra no backup sozinho).
   ============================================================ */

/* ------------------------------------------------------------
   CÁLCULO (função pura — igual à planilha)
   ------------------------------------------------------------ */
const SAL_FAIXA_PADRAO = { teto: 1621, a1: 7.5, a2: 9 };

function salNum(v){
  const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", "."));
  return isFinite(n) ? n : 0;
}
// Aceita "16,33" ou uma soma como "9+7,33" (do jeito que a planilha usava)
function salHoras(txt){
  const s = String(txt == null ? "" : txt).replace(/\s+/g, "");
  if (!s) return { total: 0, ok: true };
  if (!/^[0-9.,+]+$/.test(s)) return { total: 0, ok: false };
  let total = 0, ok = true;
  s.split("+").forEach(p => {
    if (p === "") return;
    const n = parseFloat(p.replace(",", "."));
    if (isFinite(n)) total += n; else ok = false;
  });
  return { total, ok };
}
const salR2 = v => Math.round((v + Number.EPSILON) * 100) / 100;

function calcularSalario(s, hojeISO){
  const faixa = Object.assign({}, SAL_FAIXA_PADRAO, s.inss || {});
  const bruto = salNum(s.bruto);
  const triPct = salNum(s.triPct);
  const trienio = bruto * triPct / 100;
  const faltas = salHoras(s.horasFaltas).total * salNum(s.valorHora);
  const base = bruto - faltas;
  const juntos = base + trienio;
  const extras = salHoras(s.horasExtras).total * salNum(s.valorHoraExtra);
  const producao = salNum(s.producao);
  const totalBruto = juntos + extras + producao;
  const baseInss = Math.max(0, totalBruto);
  const parte1 = Math.min(baseInss, salNum(faixa.teto)) * salNum(faixa.a1) / 100;
  const parte2 = Math.max(0, baseInss - salNum(faixa.teto)) * salNum(faixa.a2) / 100;
  const desconto = parte1 + parte2;
  const liquido = totalBruto - desconto;
  // Passagem: cada dia tem IDA e VOLTA; cada perna é paga separadamente. "Pago" não muda o total.
  const p = s.passagem || {};
  const hoje = hojeISO || salISO(new Date());
  const dias = Array.isArray(p.dias) ? p.dias : [];
  const pg = salPagoSets(p);
  const iv = salIdaVolta(p), vIda = salNum(iv.ida), vVolta = salNum(iv.volta);
  let passagemPaga = 0, passagemAtrasada = 0, passagemAPagar = 0;
  let diasPagos = 0, diasAtrasados = 0, diasAPagar = 0, idasPagas = 0, voltasPagas = 0;
  dias.forEach(d => {
    const i = pg.ida.has(d), v = pg.volta.has(d);
    if (i){ passagemPaga += vIda; idasPagas++; }
    if (v){ passagemPaga += vVolta; voltasPagas++; }
    const falta = (i ? 0 : vIda) + (v ? 0 : vVolta);
    if (i && v) diasPagos++;
    else if (d <= hoje){ passagemAtrasada += falta; diasAtrasados++; }
    else { passagemAPagar += falta; diasAPagar++; }
  });
  const diasPassagem = dias.length;
  const passagem = diasPassagem * (vIda + vVolta);
  const comPassagem = liquido + passagem;
  return { bruto, trienio, triPct, faltas, base, juntos, extras, producao, totalBruto,
           parte1, parte2, desconto, liquido, diasPassagem, diasPagos, diasAtrasados, diasAPagar, idasPagas, voltasPagas,
           passagem, passagemPaga, passagemAtrasada, passagemAPagar, comPassagem, sobra: comPassagem - passagemPaga, faixa };
}

/* ------------------------------------------------------------
   FERIADOS (nacionais fixos + móveis; pontos facultativos à parte)
   ------------------------------------------------------------ */
function salPascoa(ano){
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}
function salISO(d){
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function salParseISO(iso){
  const [a, m, d] = String(iso).split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1);
}
const salCacheFeriados = {};
function salFeriadosDoAno(ano){
  if (salCacheFeriados[ano]) return salCacheFeriados[ano];
  const mapa = {};
  const fix = (m, d, nome, tipo) => { mapa[ano + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0")] = { nome, tipo }; };
  fix(1, 1, "Confraternização Universal", "feriado");
  fix(4, 21, "Tiradentes", "feriado");
  fix(5, 1, "Dia do Trabalho", "feriado");
  fix(9, 7, "Independência do Brasil", "feriado");
  fix(10, 12, "Nossa Sra. Aparecida", "feriado");
  fix(11, 2, "Finados", "feriado");
  fix(11, 15, "Proclamação da República", "feriado");
  if (ano >= 2024) fix(11, 20, "Consciência Negra", "feriado");
  fix(12, 25, "Natal", "feriado");
  const pascoa = salPascoa(ano);
  const mov = (dias, nome, tipo) => { const d = new Date(pascoa); d.setDate(d.getDate() + dias); mapa[salISO(d)] = { nome, tipo }; };
  mov(-2, "Sexta-feira Santa", "feriado");
  mov(-48, "Carnaval (segunda)", "facultativo");
  mov(-47, "Carnaval (terça)", "facultativo");
  mov(-46, "Quarta-feira de Cinzas", "facultativo");
  mov(60, "Corpus Christi", "facultativo");
  fix(10, 28, "Dia do Servidor Público", "facultativo");
  fix(12, 24, "Véspera de Natal", "facultativo");
  fix(12, 31, "Véspera de Ano Novo", "facultativo");
  return (salCacheFeriados[ano] = mapa);
}
// Nada é bloqueado: o app só INFORMA o feriado; quem decide se o dia conta é você.
function salInfoDia(iso){
  const d = salParseISO(iso);
  const fer = salFeriadosDoAno(d.getFullYear())[iso];
  const dow = d.getDay();
  return { feriado: fer ? fer.nome : "", tipoFeriado: fer ? fer.tipo : "", fimDeSemana: dow === 0 || dow === 6 };
}

/* ------------------------------------------------------------
   "MARCAR 5 → 5": do dia 5 do mês até o dia 5 do mês seguinte.
   Pula sábado, domingo, feriados e pontos facultativos (você marca
   na mão o que for válido) e dias que já estão em outro mês.
   ------------------------------------------------------------ */
function salCincoACinco(ano, mesIdx0){
  return { de: salISO(new Date(ano, mesIdx0, 5)), ate: salISO(new Date(ano, mesIdx0 + 1, 5)) };
}
function salDiasParaMarcar(de, ate, outros){
  const marcar = [], pulados = [];
  for (let d = salParseISO(de), fim = salParseISO(ate); d <= fim; d.setDate(d.getDate() + 1)){
    const iso = salISO(d), inf = salInfoDia(iso);
    if (outros && outros[iso]) continue;
    if (inf.fimDeSemana) continue;
    if (inf.feriado){ pulados.push(iso); continue; }
    marcar.push(iso);
  }
  return { marcar, pulados };
}
function salDiasEmOutrosMeses(mesAtual, idx){
  const mapa = {};
  for (let m = 1; m <= 12; m++){
    if (m === mesAtual) continue;
    const s = (estado.meses[m].salarios || [])[idx];
    if (s && s.passagem && Array.isArray(s.passagem.dias)) s.passagem.dias.forEach(d => { if (!mapa[d]) mapa[d] = m; });
  }
  return mapa;
}

/* ------------------------------------------------------------
   DADOS
   ------------------------------------------------------------ */
function salPagoSets(p){
  p = p || {};
  const leg = Array.isArray(p.pagos) ? p.pagos : [];
  return { ida: new Set((Array.isArray(p.pagosIda) ? p.pagosIda : []).concat(leg)),
           volta: new Set((Array.isArray(p.pagosVolta) ? p.pagosVolta : []).concat(leg)) };
}
function salIdaVolta(p){
  p = p || {};
  if (p.ida != null || p.volta != null) return { ida: p.ida != null ? p.ida : "", volta: p.volta != null ? p.volta : "" };
  const v = salNum(p.valorDia);
  return v > 0 ? { ida: String(salR2(v / 2)), volta: String(salR2(v / 2)) } : { ida: "", volta: "" };
}
function salariosDoMes(mes){
  const m = estado.meses[mes];
  if (!Array.isArray(m.salarios)) m.salarios = [];
  return m.salarios;
}
function salNomePadrao(i){ return i ? "Salário " + (i + 1) : "Salário"; }
function salPadrao(idx){
  if (!Array.isArray(estado.salarioPadrao)) estado.salarioPadrao = [];
  if (!estado.salarioPadrao[idx]) estado.salarioPadrao[idx] = {};
  return estado.salarioPadrao[idx];
}
function sincronizarSalarioNaRenda(mes){
  const m = estado.meses[mes];
  const linhas = [];
  salariosDoMes(mes).forEach((s, i) => {
    if (!s) return;
    const liq = salR2(calcularSalario(s).liquido);
    if (liq > 0) linhas.push({ id: "salario_" + i, descricao: s.nome || salNomePadrao(i), valor: liq, valorPrevisto: liq, origem: "salario", slot: i });
  });
  m.renda = linhas.concat(m.renda.filter(r => r.origem !== "salario"));
}
function salRascunhoNovo(mes, idx){
  const pad = salPadrao(idx);
  return {
    nome: "", bruto: pad.bruto != null ? pad.bruto : "", triPct: pad.triPct != null ? pad.triPct : (idx === 0 ? 5 : 0),
    horasFaltas: "", valorHora: pad.valorHora != null ? pad.valorHora : "",
    horasExtras: "", valorHoraExtra: pad.valorHoraExtra != null ? pad.valorHoraExtra : "", producao: "",
    inss: Object.assign({}, SAL_FAIXA_PADRAO, pad.inss || {}),
    passagem: Object.assign({ valorDia: pad.valorDia != null ? pad.valorDia : "", dias: [], pagosIda: [], pagosVolta: [] }, salIdaVolta({ ida: pad.ida, volta: pad.volta, valorDia: pad.valorDia }))
  };
}

/* ------------------------------------------------------------
   CARTÃO NA ABA MÊS
   ------------------------------------------------------------ */
function renderizarSalarios(mes){
  const el = document.getElementById("salario-lista");
  if (!el) return;
  const tit = document.getElementById("salario-card-mes");
  if (tit) tit.textContent = NOMES_MESES[mes - 1];
  const slots = salariosDoMes(mes);
  let html = "";
  slots.forEach((s, i) => {
    if (!s) return;
    const c = calcularSalario(s);
    const nome = escaparHTML(s.nome || salNomePadrao(i));
    const extra = [];
    if (c.diasPassagem) extra.push(`🚌 ${c.diasPassagem} dias`);
    if (c.diasAtrasados) extra.push(`🔴 ${formatarMoeda(c.passagemAtrasada)} sem pagar`);
    html += `<button type="button" class="sal-slot sal-slot-cheio" data-sal-slot="${i}">
      <span class="sal-slot-ic">💼</span>
      <span class="sal-slot-txt"><strong>${nome}</strong>
        <small>INSS −${formatarMoeda(c.desconto)}${extra.length ? " · " + extra.join(" · ") : ""}</small></span>
      <span class="sal-slot-val"><b>${formatarMoeda(c.liquido)}</b><small>${c.passagem > 0 ? "c/ passagem " + formatarMoeda(c.comPassagem) : "líquido"}</small></span>
      <span class="sal-slot-edit">✎</span></button>`;
  });
  const temAlgum = slots.some(Boolean);
  let idxNovo = slots.findIndex(x => !x); if (idxNovo < 0) idxNovo = slots.length;
  html += `<button type="button" class="sal-slot sal-slot-vazio" data-sal-slot="${idxNovo}">
    <span class="sal-slot-mais">＋</span>
    <span class="sal-slot-txt"><strong>${temAlgum ? "Adicionar outro salário" : "Cadastrar salário"}</strong>
    <small>${temAlgum ? "Abre o mesmo cálculo, do zero" : "Bruto, triênio, extras, INSS e passagem"}</small></span></button>`;
  el.innerHTML = html;
  el.querySelectorAll("[data-sal-slot]").forEach(b => b.addEventListener("click", () => abrirSalario(mes, Number(b.dataset.salSlot))));
}

/* ------------------------------------------------------------
   PAINEL FLUTUANTE
   ------------------------------------------------------------ */
let salS = null; // { mes, idx, d (rascunho), viewY, viewM, existia }

function salCampo(id, rotulo, extra, saida){
  return `<label class="sal-campo"><span class="sal-rot">${rotulo}${saida ? `<output id="${saida}" class="sal-saida"></output>` : ""}</span>${extra}</label>`;
}
function salLinha(rotulo, id, cls){
  return `<div class="sal-linha ${cls || ""}"><span>${rotulo}</span><b id="${id}">—</b></div>`;
}

function montarSalarioDOM(){
  if (document.getElementById("modal-salario")) return;
  const ov = document.createElement("div");
  ov.className = "modal-overlay hidden";
  ov.id = "modal-salario";
  ov.innerHTML = `
  <div class="sal-sheet" role="dialog" aria-modal="true" aria-labelledby="sal-titulo">
    <div class="sal-topo">
      <span class="sal-topo-ic">💼</span>
      <div class="sal-topo-t"><h3 id="sal-titulo">Salário</h3><small id="sal-sub"></small></div>
      <button type="button" class="sal-x" id="sal-fechar" aria-label="Fechar">✕</button>
    </div>
    <div class="sal-corpo">
      <div class="sal-bloco">
        ${salCampo("sal-nome", "Nome deste salário", `<input type="text" id="sal-nome" maxlength="30" placeholder="Ex.: Salário, Ludmila…">`)}
      </div>

      <div class="sal-bloco">
        <h4>💰 Rendimentos</h4>
        ${salCampo("sal-bruto", "Salário bruto (R$)", `<input type="number" id="sal-bruto" inputmode="decimal" min="0" step="0.01" placeholder="0,00">`)}
        <div class="sal-dupla">
          ${salCampo("sal-tri", "Triênio (%)", `<input type="number" id="sal-tri" inputmode="decimal" min="0" step="0.01" placeholder="5">`, "sal-o-tri")}
          ${salCampo("sal-prod", "10% Produção (R$)", `<input type="number" id="sal-prod" inputmode="decimal" min="0" step="0.01" placeholder="0,00">`)}
        </div>
        <div class="sal-dupla">
          ${salCampo("sal-h-extra", "Sábados/Extras (horas)", `<input type="text" id="sal-h-extra" autocomplete="off" placeholder="Ex.: 4,1 ou 2+2,1">`, "sal-o-hextra")}
          ${salCampo("sal-v-extra", "Valor da hora extra", `<input type="number" id="sal-v-extra" inputmode="decimal" min="0" step="0.01" placeholder="0,00">`, "sal-o-extra")}
        </div>
      </div>

      <div class="sal-bloco">
        <h4>📉 Faltas / DSR <em>(desconto)</em></h4>
        <div class="sal-dupla">
          ${salCampo("sal-h-falta", "Horas de falta", `<input type="text" id="sal-h-falta" autocomplete="off" placeholder="Ex.: 9+7,33">`, "sal-o-hfalta")}
          ${salCampo("sal-v-hora", "Valor da hora normal", `<input type="number" id="sal-v-hora" inputmode="decimal" min="0" step="0.01" placeholder="0,00">`, "sal-o-falta")}
        </div>
        <p class="sal-dica">Dá para somar horas direto no campo, como na planilha: <b>9+7,33</b>.</p>
      </div>

      <div class="sal-bloco sal-resumo">
        ${salLinha("Base reajustada", "sal-r-base")}
        ${salLinha("Total juntos (base + trienio)", "sal-r-juntos")}
        ${salLinha("Sábados/Extras + produção", "sal-r-extras")}
        ${salLinha("Total bruto", "sal-r-bruto", "sal-destaque")}
      </div>

      <div class="sal-bloco">
        <h4>🏛️ Desconto INSS</h4>
        ${salLinha('<span id="sal-l-p1">Parte 7,5%</span>', "sal-r-p1")}
        ${salLinha('<span id="sal-l-p2">Parte 9%</span>', "sal-r-p2")}
        ${salLinha("Total de desconto", "sal-r-desc", "sal-neg")}
        <details class="sal-det"><summary>Ajustar faixas do INSS</summary>
          <div class="sal-dupla">
            ${salCampo("sal-i-teto", "Teto da 1ª faixa (R$)", `<input type="number" id="sal-i-teto" inputmode="decimal" min="0" step="0.01">`)}
            ${salCampo("sal-i-a1", "Alíquota 1ª (%)", `<input type="number" id="sal-i-a1" inputmode="decimal" min="0" step="0.01">`)}
            ${salCampo("sal-i-a2", "Alíquota acima (%)", `<input type="number" id="sal-i-a2" inputmode="decimal" min="0" step="0.01">`)}
          </div>
        </details>
      </div>

      <div class="sal-hero">
        <span>TOTAL LÍQUIDO</span><b id="sal-r-liq">R$ 0,00</b>
        <small>É este valor que aparece em “Renda mensal” lá em cima.</small>
      </div>

      <div class="sal-bloco sal-passagem">
        <h4>🚌 Passagem <em>(fica só aqui, não sobe para a renda)</em></h4>
        <div class="sal-dupla">
          ${salCampo("sal-p-ida", "🚌 Ida (R$)", `<input type="number" id="sal-p-ida" inputmode="decimal" min="0" step="0.01" placeholder="Ex.: 4,50">`)}
          ${salCampo("sal-p-volta", "🏠 Volta (R$)", `<input type="number" id="sal-p-volta" inputmode="decimal" min="0" step="0.01" placeholder="Ex.: 4,50">`)}
        </div>
        ${salLinha("Por dia (ida + volta)", "sal-r-dia", "sal-destaque")}
        <div class="sal-cal">
          <div class="sal-cal-nav">
            <button type="button" id="sal-cal-ant" aria-label="Mês anterior">‹</button>
            <strong id="sal-cal-titulo"></strong>
            <button type="button" id="sal-cal-prox" aria-label="Próximo mês">›</button>
          </div>
          <div class="sal-cal-sem"><i>D</i><i>S</i><i>T</i><i>Q</i><i>Q</i><i>S</i><i>S</i></div>
          <div class="sal-cal-grade" id="sal-cal-grade"></div>
          <p class="sal-cal-dica">Toque num dia vazio para <b>marcar</b>. Toque num dia marcado para pagar a <b>ida</b>, a <b>volta</b> ou <b>as duas</b>. Deslize para os lados para trocar de mês.</p>
          <div class="sal-cal-leg">
            <span><i class="lg lg-pend"></i>A usar</span>
            <span><i class="lg lg-atras"></i>Passou, falta pagar</span>
            <span><i class="lg lg-pago"></i>Pago</span>
            <span><i class="lg lg-meio"></i>Metade paga (esq. ida · dir. volta)</span>
            <span><i class="lg lg-fer"></i>Feriado (você decide)</span>
          </div>
        </div>
        <div class="sal-cal-acoes">
          <button type="button" class="btn-primary-outline" id="sal-marcar-5">Marcar 5 → 5</button>
          <button type="button" class="btn-secondary" id="sal-limpar-dias">Limpar tudo</button>
        </div>
        <div class="sal-subconta">
          <h5>🧾 Subconta da passagem</h5>
          ${salLinha('<span id="sal-l-pass">0 dias × R$ 0,00</span>', "sal-r-pass")}
          ${salLinha('<span id="sal-l-paga">✅ Já paga</span>', "sal-r-paga", "sal-pos")}
          ${salLinha('<span id="sal-l-atras">🔴 Passou e falta pagar</span>', "sal-r-atras", "sal-neg")}
          ${salLinha('<span id="sal-l-apagar">🔵 A pagar (próximos dias)</span>', "sal-r-apagar", "sal-azul")}
          ${salLinha("TOTAL COM PASSAGEM <small>(líquido + passagem)</small>", "sal-r-comp", "sal-destaque")}
          ${salLinha("Sobra (com passagem − já paga)", "sal-r-sobra")}
        </div>
      </div>
    </div>
    <div class="sal-dia-fundo hidden" id="sal-dia" aria-hidden="true">
      <div class="sal-dia" role="dialog" aria-labelledby="sal-dia-titulo">
        <div class="sal-dia-topo"><div><strong id="sal-dia-titulo"></strong><small id="sal-dia-sub"></small></div><button type="button" class="sal-x" id="sal-dia-x" aria-label="Fechar">✕</button></div>
        <div class="sal-dia-pernas">
          <button type="button" class="sal-perna" id="sal-perna-ida"></button>
          <button type="button" class="sal-perna" id="sal-perna-volta"></button>
        </div>
        <button type="button" class="btn-primary" id="sal-dia-ambos"></button>
        <button type="button" class="btn-danger-outline" id="sal-dia-desmarcar">Desmarcar este dia</button>
      </div>
    </div>
    <div class="sal-rodape">
      <button type="button" class="btn-danger-outline hidden" id="sal-remover">🗑️ Remover</button>
      <button type="button" class="btn-primary" id="sal-salvar">Salvar salário</button>
    </div>
  </div>`;
  const ref = document.getElementById("modal-confirmacao");
  if (ref) ref.parentNode.insertBefore(ov, ref); else document.body.appendChild(ov);

  const $ = id => document.getElementById(id);
  $("sal-fechar").addEventListener("click", fecharSalario);
  ov.addEventListener("click", e => { if (e.target === ov) fecharSalario(); });
  $("sal-salvar").addEventListener("click", salvarSalario);
  $("sal-remover").addEventListener("click", removerSalario);
  ov.querySelectorAll(".sal-corpo input[id]").forEach(inp => {
    inp.addEventListener("input", () => { salLerForm(); salAtualizar(); });
  });
  $("sal-cal-ant").addEventListener("click", () => salNavegar(-1));
  $("sal-cal-prox").addEventListener("click", () => salNavegar(1));
  $("sal-cal-grade").addEventListener("click", e => {
    const c = e.target.closest("[data-d]");
    if (c) salToqueDia(c.dataset.d);
  });
  // deslizar o calendário para os lados troca de mês
  let tx = 0, ty = 0;
  const grade = $("sal-cal-grade");
  grade.addEventListener("touchstart", e => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
  grade.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 55 && Math.abs(dy) < 45) salNavegar(dx < 0 ? 1 : -1);
  }, { passive: true });
  $("sal-marcar-5").addEventListener("click", salMarcarCincoACinco);
  $("sal-dia-x").addEventListener("click", salFecharDia);
  $("sal-dia").addEventListener("click", e => { if (e.target.id === "sal-dia") salFecharDia(); });
  $("sal-perna-ida").addEventListener("click", () => salAlternarPerna("ida"));
  $("sal-perna-volta").addEventListener("click", () => salAlternarPerna("volta"));
  $("sal-dia-ambos").addEventListener("click", salPagarAmbos);
  $("sal-dia-desmarcar").addEventListener("click", salDesmarcarDia);
  $("sal-limpar-dias").addEventListener("click", () => {
    const p = salS.d.passagem; p.dias = []; p.pagosIda = []; p.pagosVolta = [];
    vibrarLeve(); salRenderCal(); salAtualizar();
  });
}

function abrirSalario(mes, idx){
  montarSalarioDOM();
  const existente = salariosDoMes(mes)[idx];
  const d = existente ? JSON.parse(JSON.stringify(existente)) : salRascunhoNovo(mes, idx);
  if (!d.passagem) d.passagem = { valorDia: "", dias: [], pagos: [] };
  Object.assign(d.passagem, salIdaVolta(d.passagem));
  if (!Array.isArray(d.passagem.dias)) d.passagem.dias = [];
  const pgs = salPagoSets(d.passagem);   // formato antigo ("pagos") vira ida + volta pagas
  d.passagem.pagosIda = Array.from(pgs.ida).filter(x => d.passagem.dias.includes(x)).sort();
  d.passagem.pagosVolta = Array.from(pgs.volta).filter(x => d.passagem.dias.includes(x)).sort();
  delete d.passagem.pagos;
  if (!d.inss) d.inss = Object.assign({}, SAL_FAIXA_PADRAO);
  salS = { mes, idx, d, viewY: anoParaMes(mes), viewM: mes - 1, existia: !!existente, outros: salDiasEmOutrosMeses(mes, idx), dia: null };

  const $ = id => document.getElementById(id);
  $("sal-titulo").textContent = idx === 0 ? "Salário" : "Outro salário";
  $("sal-sub").textContent = NOMES_MESES[mes - 1] + " de " + anoParaMes(mes);
  $("sal-nome").value = d.nome || "";
  $("sal-bruto").value = d.bruto;
  $("sal-tri").value = d.triPct;
  $("sal-prod").value = d.producao;
  $("sal-h-extra").value = d.horasExtras;
  $("sal-v-extra").value = d.valorHoraExtra;
  $("sal-h-falta").value = d.horasFaltas;
  $("sal-v-hora").value = d.valorHora;
  $("sal-i-teto").value = d.inss.teto; $("sal-i-a1").value = d.inss.a1; $("sal-i-a2").value = d.inss.a2;
  const iv = salIdaVolta(d.passagem);
  $("sal-p-ida").value = iv.ida; $("sal-p-volta").value = iv.volta;
  $("sal-remover").classList.toggle("hidden", !existente);
  $("sal-salvar").textContent = existente ? "Salvar alterações" : "Salvar salário";
  document.querySelector("#modal-salario .sal-corpo").scrollTop = 0;
  $("modal-salario").classList.remove("hidden");
  document.body.classList.add("sal-aberto");
  salRenderCal();
  salAtualizar();
}

function fecharSalario(){
  const m = document.getElementById("modal-salario");
  if (m) m.classList.add("hidden");
  document.body.classList.remove("sal-aberto");
  const jd = document.getElementById("sal-dia"); if (jd) jd.classList.add("hidden");
  salS = null;
}

function salLerForm(){
  const $ = id => document.getElementById(id), d = salS.d;
  d.nome = $("sal-nome").value.trim();
  d.bruto = $("sal-bruto").value; d.triPct = $("sal-tri").value; d.producao = $("sal-prod").value;
  d.horasExtras = $("sal-h-extra").value; d.valorHoraExtra = $("sal-v-extra").value;
  d.horasFaltas = $("sal-h-falta").value; d.valorHora = $("sal-v-hora").value;
  d.inss = { teto: $("sal-i-teto").value, a1: $("sal-i-a1").value, a2: $("sal-i-a2").value };
  d.passagem.ida = $("sal-p-ida").value; d.passagem.volta = $("sal-p-volta").value;
  d.passagem.valorDia = String(salR2(salNum(d.passagem.ida) + salNum(d.passagem.volta)));
}

function salAtualizar(){
  if (!salS) return;
  const $ = id => document.getElementById(id), d = salS.d, c = calcularSalario(d);
  const m = formatarMoeda;
  const fx = c.faixa, fmtPct = v => String(salNum(v)).replace(".", ",") + "%";
  const he = salHoras(d.horasExtras), hf = salHoras(d.horasFaltas);
  $("sal-o-tri").textContent = c.trienio ? "= " + m(c.trienio) : "";
  $("sal-o-extra").textContent = c.extras ? "= " + m(c.extras) : "";
  $("sal-o-hextra").textContent = he.ok ? (String(d.horasExtras).includes("+") ? "= " + String(he.total).replace(".", ",") + " h" : "") : "⚠ inválido";
  $("sal-o-hfalta").textContent = hf.ok ? (String(d.horasFaltas).includes("+") ? "= " + String(hf.total).replace(".", ",") + " h" : "") : "⚠ inválido";
  $("sal-o-falta").textContent = c.faltas ? "= −" + m(c.faltas) : "";
  $("sal-r-base").textContent = m(c.base);
  $("sal-r-juntos").textContent = m(c.juntos);
  $("sal-r-extras").textContent = m(c.extras + c.producao);
  $("sal-r-bruto").textContent = m(c.totalBruto);
  $("sal-l-p1").textContent = `Parte ${fmtPct(fx.a1)} (até ${m(salNum(fx.teto))})`;
  $("sal-l-p2").textContent = `Parte ${fmtPct(fx.a2)} (acima)`;
  $("sal-r-p1").textContent = "−" + m(c.parte1);
  $("sal-r-p2").textContent = "−" + m(c.parte2);
  $("sal-r-desc").textContent = "−" + m(c.desconto);
  $("sal-r-liq").textContent = m(c.liquido);
  const pl = (n) => n + (n === 1 ? " dia" : " dias");
  $("sal-r-dia").textContent = m(salNum(d.passagem.valorDia));
  $("sal-l-pass").textContent = `Total: ${pl(c.diasPassagem)} × ${m(salNum(d.passagem.valorDia))}`;
  $("sal-r-pass").textContent = m(c.passagem);
  $("sal-l-paga").textContent = `✅ Já paga (${c.idasPagas} ${c.idasPagas === 1 ? "ida" : "idas"} · ${c.voltasPagas} ${c.voltasPagas === 1 ? "volta" : "voltas"})`;
  $("sal-r-paga").textContent = m(c.passagemPaga);
  $("sal-l-atras").textContent = `🔴 Passou e falta pagar (${pl(c.diasAtrasados)})`;
  $("sal-r-atras").textContent = m(c.passagemAtrasada);
  $("sal-l-apagar").textContent = `🔵 A pagar nos próximos dias (${pl(c.diasAPagar)})`;
  $("sal-r-apagar").textContent = m(c.passagemAPagar);
  $("sal-r-comp").textContent = m(c.comPassagem);
  $("sal-r-sobra").textContent = m(c.sobra);
}

/* ---------- calendário da passagem ---------- */
function salRenderCal(){
  const $ = id => document.getElementById(id), p = salS.d.passagem;
  const { viewY: Y, viewM: M } = salS;
  $("sal-cal-titulo").textContent = NOMES_MESES[M] + " " + Y;
  const prox = new Date(Y, M + 1, 1);
  $("sal-marcar-5").textContent = `Marcar 5/${NOMES_MESES[M].slice(0, 3).toLowerCase()} → 5/${NOMES_MESES[prox.getMonth()].slice(0, 3).toLowerCase()}`;
  const primeiro = new Date(Y, M, 1), nDias = new Date(Y, M + 1, 0).getDate();
  const hoje = salISO(new Date()), sel = new Set(p.dias), pg = salPagoSets(p);
  let h = "";
  for (let i = 0; i < primeiro.getDay(); i++) h += `<i class="sal-d vazio"></i>`;
  for (let dia = 1; dia <= nDias; dia++){
    const iso = salISO(new Date(Y, M, dia)), inf = salInfoDia(iso);
    const cls = ["sal-d"];
    let rotulo = String(dia);
    if (inf.fimDeSemana) cls.push("fds");
    if (inf.feriado){ cls.push(inf.tipoFeriado === "feriado" ? "fer" : "fac"); rotulo += ", " + inf.feriado; }
    if (salS.outros[iso]){ cls.push("outro"); rotulo += ", já na passagem de " + NOMES_MESES[salS.outros[iso] - 1]; }
    else if (sel.has(iso)){
      const i = pg.ida.has(iso), v = pg.volta.has(iso), resto = iso <= hoje ? "rest-atras" : "rest-pend";
      if (i && v){ cls.push("pago"); rotulo += ", ida e volta pagas"; }
      else if (i){ cls.push("meio-ida", resto); rotulo += ", ida paga, volta pendente"; }
      else if (v){ cls.push("meio-volta", resto); rotulo += ", volta paga, ida pendente"; }
      else if (iso <= hoje){ cls.push("atras"); rotulo += ", passou e falta pagar"; }
      else { cls.push("pend"); rotulo += ", marcado"; }
    }
    if (iso === hoje) cls.push("hoje");
    h += `<button type="button" class="${cls.join(" ")}" data-d="${iso}" ${inf.feriado ? `title="${inf.feriado}"` : ""} aria-label="${rotulo}">${dia}</button>`;
  }
  $("sal-cal-grade").innerHTML = h;
}
function salNavegar(delta){
  if (salS.dia) salFecharDia();
  const d = new Date(salS.viewY, salS.viewM + delta, 1);
  salS.viewY = d.getFullYear(); salS.viewM = d.getMonth();
  salRenderCal();
}
// toque num dia vazio: marca · toque num dia marcado: abre a janelinha (ida / volta)
function salToqueDia(iso){
  const p = salS.d.passagem, inf = salInfoDia(iso);
  if (salS.outros[iso]){ mostrarToast("Este dia já está na passagem de " + NOMES_MESES[salS.outros[iso] - 1] + "."); vibrarLeve(); return; }
  if (!p.dias.includes(iso)){
    p.dias.push(iso); p.dias.sort();
    if (inf.feriado) mostrarToast(inf.feriado + " marcado — você decide se conta.");
    vibrarLeve(); salRenderCal(); salAtualizar();
    return;
  }
  vibrarLeve();
  salAbrirDia(iso);
}
const SAL_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
function salAbrirDia(iso){
  salS.dia = iso;
  salRenderDia();
  document.getElementById("sal-dia").classList.remove("hidden");
}
function salFecharDia(){
  if (salS) salS.dia = null;
  document.getElementById("sal-dia").classList.add("hidden");
}
function salRenderDia(){
  const iso = salS.dia; if (!iso) return;
  const $ = id => document.getElementById(id), p = salS.d.passagem;
  const d = salParseISO(iso), pg = salPagoSets(p), iv = salIdaVolta(p), inf = salInfoDia(iso);
  $("sal-dia-titulo").textContent = `${SAL_SEMANA[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  $("sal-dia-sub").textContent = inf.feriado ? "🎌 " + inf.feriado : (iso <= salISO(new Date()) ? "Esse dia já passou" : "Dia que ainda vem");
  const perna = (id, ico, nome, valor, pago) => {
    const b = $(id);
    b.className = "sal-perna " + (pago ? "paga" : "pendente");
    b.innerHTML = `<span class="sal-perna-ic">${ico}</span><span class="sal-perna-n"><strong>${nome}</strong><small>${formatarMoeda(salNum(valor))}</small></span><b>${pago ? "✓ Paga" : "Pendente"}</b>`;
  };
  const i = pg.ida.has(iso), v = pg.volta.has(iso);
  perna("sal-perna-ida", "🚌", "Ida", iv.ida, i);
  perna("sal-perna-volta", "🏠", "Volta", iv.volta, v);
  $("sal-dia-ambos").textContent = i && v ? "Voltar os dois para pendente" : "Pagar ida e volta";
}
function salAlternarPerna(perna){
  const p = salS.d.passagem, iso = salS.dia; if (!iso) return;
  const lista = perna === "ida" ? p.pagosIda : p.pagosVolta;
  const k = lista.indexOf(iso);
  if (k >= 0) lista.splice(k, 1); else lista.push(iso);
  vibrarLeve(); salRenderDia(); salRenderCal(); salAtualizar();
}
function salPagarAmbos(){
  const p = salS.d.passagem, iso = salS.dia; if (!iso) return;
  const pg = salPagoSets(p), ambos = pg.ida.has(iso) && pg.volta.has(iso);
  p.pagosIda = p.pagosIda.filter(x => x !== iso); p.pagosVolta = p.pagosVolta.filter(x => x !== iso);
  if (!ambos){ p.pagosIda.push(iso); p.pagosVolta.push(iso); }
  vibrarLeve(); salRenderCal(); salAtualizar();
  if (ambos) salRenderDia(); else salFecharDia();
}
function salDesmarcarDia(){
  const p = salS.d.passagem, iso = salS.dia; if (!iso) return;
  p.dias = p.dias.filter(x => x !== iso);
  p.pagosIda = p.pagosIda.filter(x => x !== iso); p.pagosVolta = p.pagosVolta.filter(x => x !== iso);
  vibrarLeve(); salFecharDia(); salRenderCal(); salAtualizar();
}
function salMarcarCincoACinco(){
  const p = salS.d.passagem;
  const per = salCincoACinco(salS.viewY, salS.viewM);
  const r = salDiasParaMarcar(per.de, per.ate, salS.outros);
  const novos = r.marcar.filter(d => !p.dias.includes(d));
  p.dias = Array.from(new Set(p.dias.concat(r.marcar))).sort();
  vibrarLeve();
  salRenderCal(); salAtualizar();
  mostrarToast(`${novos.length} ${novos.length === 1 ? "dia marcado" : "dias marcados"}` + (r.pulados.length ? ` · pulei ${r.pulados.length} feriado${r.pulados.length > 1 ? "s" : ""} (toque se valer)` : ""));
}

/* ---------- salvar / remover ---------- */
function salvarSalario(){
  if (!salS) return;
  salLerForm();
  const d = salS.d, c = calcularSalario(d);
  if (c.bruto <= 0 && c.diasPassagem === 0){ mostrarToast("Preencha o salário bruto."); return; }
  if (!salHoras(d.horasExtras).ok || !salHoras(d.horasFaltas).ok){ mostrarToast("Confira as horas: use só números, vírgula e +."); return; }
  const { mes, idx } = salS;
  const limpo = JSON.parse(JSON.stringify(d));
  salariosDoMes(mes)[idx] = limpo;
  // lembra os valores fixos para facilitar o próximo mês (horas de falta/extra NÃO são lembradas)
  const pad = salPadrao(idx);
  pad.bruto = d.bruto; pad.triPct = d.triPct; pad.valorHora = d.valorHora; pad.valorHoraExtra = d.valorHoraExtra;
  pad.inss = Object.assign({}, d.inss); pad.valorDia = d.passagem.valorDia; pad.ida = d.passagem.ida; pad.volta = d.passagem.volta;
  sincronizarSalarioNaRenda(mes);
  salvarEstado();
  fecharSalario();
  renderizarMes(mes);
  mostrarToast(c.liquido > 0 ? "Salário salvo! Líquido " + formatarMoeda(salR2(c.liquido)) + " na renda do mês." : "Salvo!");
}
function removerSalario(){
  if (!salS) return;
  const { mes, idx } = salS;
  confirmarElegante("Remover este salário do mês? Ele também some da Renda mensal.", () => {
    const lista = salariosDoMes(mes);
    lista[idx] = null;
    while (lista.length && !lista[lista.length - 1]) lista.pop();
    sincronizarSalarioNaRenda(mes);
    salvarEstado();
    fecharSalario();
    renderizarMes(mes);
    mostrarToast("Salário removido.");
  }, { titulo: "🗑️ Remover salário", textoConfirmar: "Remover" });
}
