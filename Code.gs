const CONFIG = {
  NOME_ABA: 'Respostas ao formulário 1',
  NOME_LISTA_TAREFAS: 'Projetos e publicações',
  LIMITE_TITULO: 80,
  LIMITE_NOTAS: 8000,
  COLUNA_STATUS: 'Status da tarefa',
  COLUNA_ID_TAREFA: 'ID da tarefa no Google Tarefas'
};

/**
 * Executada automaticamente quando uma resposta é enviada pelo formulário.
 * O gatilho instalável é criado pela função configurarAutomacao().
 */
function aoEnviarFormulario(e) {
  const planilha = e.source;
  const aba = e.range.getSheet();

  if (aba.getName() !== CONFIG.NOME_ABA) {
    return;
  }

  processarLinha_(planilha, aba, e.range.getRow());
}

/**
 * Execute esta função uma única vez para:
 * 1. garantir as colunas técnicas;
 * 2. garantir a lista no Google Tarefas;
 * 3. criar o gatilho de envio do formulário.
 */
function configurarAutomacao() {
  const planilha = SpreadsheetApp.getActive();
  const aba = planilha.getSheetByName(CONFIG.NOME_ABA);

  if (!aba) {
    throw new Error(
      'A aba "' + CONFIG.NOME_ABA + '" não foi encontrada. ' +
      'Atualize CONFIG.NOME_ABA com o nome correto.'
    );
  }

  garantirColuna_(aba, CONFIG.COLUNA_STATUS);
  garantirColuna_(aba, CONFIG.COLUNA_ID_TAREFA);
  obterOuCriarListaDeTarefas_();

  const gatilhoExiste = ScriptApp.getProjectTriggers().some(function(gatilho) {
    return gatilho.getHandlerFunction() === 'aoEnviarFormulario';
  });

  if (!gatilhoExiste) {
    ScriptApp
      .newTrigger('aoEnviarFormulario')
      .forSpreadsheet(planilha)
      .onFormSubmit()
      .create();
  }

  console.log(
    'Automação configurada. As próximas respostas serão processadas automaticamente.'
  );
}

/**
 * Processa uma linha da planilha de respostas.
 */
function processarLinha_(planilha, aba, numeroLinha) {
  const ultimaColuna = aba.getLastColumn();
  const cabecalhos = aba
    .getRange(1, 1, 1, ultimaColuna)
    .getDisplayValues()[0];
  const valores = aba
    .getRange(numeroLinha, 1, 1, ultimaColuna)
    .getValues()[0];
  const valoresExibidos = aba
    .getRange(numeroLinha, 1, 1, ultimaColuna)
    .getDisplayValues()[0];

  const mapa = mapearColunas_(cabecalhos);
  const colunaStatus = localizarColuna_(mapa, [CONFIG.COLUNA_STATUS]);
  const colunaId = localizarColuna_(mapa, [CONFIG.COLUNA_ID_TAREFA]);

  try {
    const ideia = obterValorExibido_(
      mapa,
      valoresExibidos,
      ['Ideia', 'Ideias', 'Título da ideia']
    );
    const tipo = obterValorExibido_(
      mapa,
      valoresExibidos,
      ['Tipo', 'Tipo de Ideias', 'Tipo de ideias', 'Tipo de produção']
    );
    const proximaAcao = obterValorExibido_(
      mapa,
      valoresExibidos,
      ['Ações', 'Próxima ação']
    );
    const observacoes = obterValorExibido_(
      mapa,
      valoresExibidos,
      ['Observações ou links']
    );
    const anexos = obterValorExibido_(
      mapa,
      valoresExibidos,
      ['Anexar prints, PDFs ou documentos relacionados']
    );
    const dataPrazo = obterValorOriginal_(
      mapa,
      valores,
      ['Data do prazo']
    );

    if (!ideia) {
      throw new Error('A coluna "Ideia" está vazia nesta resposta.');
    }

    if (!dataPrazo) {
      atualizarCelula_(aba, numeroLinha, colunaStatus, 'Sem prazo');
      atualizarCelula_(aba, numeroLinha, colunaId, '');
      return;
    }

    const dataValida = dataPrazo instanceof Date
      ? dataPrazo
      : new Date(dataPrazo);

    if (isNaN(dataValida.getTime())) {
      throw new Error('A data do prazo não pôde ser interpretada.');
    }

    const lista = obterOuCriarListaDeTarefas_();
    const idExistente = obterValorExibido_(
      mapa,
      valoresExibidos,
      [CONFIG.COLUNA_ID_TAREFA]
    );

    const tarefa = {
      title: montarTituloCurto_(ideia),
      notes: montarNotas_({
        ideia: ideia,
        tipo: tipo,
        proximaAcao: proximaAcao,
        observacoes: observacoes,
        anexos: anexos,
        planilha: planilha.getUrl()
      }),
      due: formatarDataTarefa_(dataValida, planilha.getSpreadsheetTimeZone()),
      status: 'needsAction'
    };

    let resultado;

    if (idExistente) {
      try {
        resultado = Tasks.Tasks.update(tarefa, lista.id, idExistente);
      } catch (erroAtualizacao) {
        resultado = Tasks.Tasks.insert(tarefa, lista.id);
      }
    } else {
      resultado = Tasks.Tasks.insert(tarefa, lista.id);
    }

    atualizarCelula_(aba, numeroLinha, colunaStatus, 'Tarefa criada');
    atualizarCelula_(aba, numeroLinha, colunaId, resultado.id);
  } catch (erro) {
    atualizarCelula_(
      aba,
      numeroLinha,
      colunaStatus,
      'Erro: ' + erro.message
    );
    throw erro;
  }
}

/**
 * Procura a lista em todas as páginas de resultados e a cria se necessário.
 */
function obterOuCriarListaDeTarefas_() {
  let token = null;

  do {
    const parametros = { maxResults: 100 };

    if (token) {
      parametros.pageToken = token;
    }

    const resposta = Tasks.Tasklists.list(parametros);
    const listaExistente = (resposta.items || []).find(function(lista) {
      return lista.title === CONFIG.NOME_LISTA_TAREFAS;
    });

    if (listaExistente) {
      return listaExistente;
    }

    token = resposta.nextPageToken || null;
  } while (token);

  return Tasks.Tasklists.insert({
    title: CONFIG.NOME_LISTA_TAREFAS
  });
}

/**
 * Monta o título visível da tarefa e evita títulos excessivamente longos.
 */
function montarTituloCurto_(ideia) {
  const prefixo = '🟢 ';
  const disponivel = CONFIG.LIMITE_TITULO - prefixo.length;
  const titulo = String(ideia).trim();

  if (titulo.length <= disponivel) {
    return prefixo + titulo;
  }

  return prefixo + titulo.slice(0, Math.max(disponivel - 1, 1)).trimEnd() + '…';
}

/**
 * Mantém o título completo e os dados da resposta nas observações.
 * Se o texto ficar muito longo, preserva o link da planilha.
 */
function montarNotas_(dados) {
  const secoes = [
    ['IDEIA', dados.ideia],
    ['TIPO', dados.tipo],
    ['AÇÕES', dados.proximaAcao],
    ['OBSERVAÇÕES E LINKS', dados.observacoes],
    ['ANEXOS', dados.anexos]
  ];

  const corpo = secoes
    .filter(function(secao) {
      return secao[1] && String(secao[1]).trim() !== '.';
    })
    .map(function(secao) {
      return secao[0] + '\n' + String(secao[1]).trim();
    })
    .join('\n\n');

  const rodape = dados.planilha
    ? 'PLANILHA\n' + dados.planilha
    : '';
  const completo = [corpo, rodape].filter(Boolean).join('\n\n');

  if (completo.length <= CONFIG.LIMITE_NOTAS) {
    return completo;
  }

  const aviso = '\n\n[Conteúdo truncado. Consulte a planilha.]\n\n';
  const espacoDisponivel = Math.max(
    CONFIG.LIMITE_NOTAS - aviso.length - rodape.length,
    0
  );

  return corpo.slice(0, espacoDisponivel).trimEnd() + aviso + rodape;
}

/**
 * A API do Google Tasks exige data/hora em formato RFC 3339.
 */
function formatarDataTarefa_(data, fusoHorario) {
  return Utilities.formatDate(
    data,
    fusoHorario || Session.getScriptTimeZone(),
    "yyyy-MM-dd'T'00:00:00.000'Z'"
  );
}

/**
 * Mapeia a primeira ocorrência de cada cabeçalho.
 * Isso evita que colunas antigas duplicadas substituam os campos atuais.
 */
function mapearColunas_(cabecalhos) {
  const mapa = {};

  cabecalhos.forEach(function(cabecalho, indice) {
    const chave = normalizar_(cabecalho);

    if (
      chave &&
      !Object.prototype.hasOwnProperty.call(mapa, chave)
    ) {
      mapa[chave] = indice;
    }
  });

  return mapa;
}

function localizarColuna_(mapa, nomesAceitos) {
  for (let i = 0; i < nomesAceitos.length; i++) {
    const chave = normalizar_(nomesAceitos[i]);

    if (Object.prototype.hasOwnProperty.call(mapa, chave)) {
      return mapa[chave] + 1;
    }
  }

  return 0;
}

function obterValorExibido_(mapa, valores, nomesAceitos) {
  const coluna = localizarColuna_(mapa, nomesAceitos);
  return coluna ? String(valores[coluna - 1] || '').trim() : '';
}

function obterValorOriginal_(mapa, valores, nomesAceitos) {
  const coluna = localizarColuna_(mapa, nomesAceitos);
  return coluna ? valores[coluna - 1] : '';
}

function garantirColuna_(aba, titulo) {
  const ultimaColuna = Math.max(aba.getLastColumn(), 1);
  const cabecalhos = aba
    .getRange(1, 1, 1, ultimaColuna)
    .getDisplayValues()[0];
  const existe = cabecalhos.some(function(cabecalho) {
    return normalizar_(cabecalho) === normalizar_(titulo);
  });

  if (!existe) {
    aba.getRange(1, ultimaColuna + 1).setValue(titulo);
  }
}

function atualizarCelula_(aba, linha, coluna, valor) {
  if (!coluna) {
    throw new Error('Uma coluna técnica necessária não foi encontrada.');
  }

  aba.getRange(linha, coluna).setValue(valor);
}

function normalizar_(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
