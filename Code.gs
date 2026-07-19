const CONFIG = {
  NOME_ABA: 'Respostas ao formulário 1',
  NOME_LISTA_TAREFAS: 'Projetos e publicações',
  LIMITE_TITULO: 80,
  COLUNA_STATUS: 'Status da tarefa',
  COLUNA_ID_TAREFA: 'ID da tarefa no Google Tarefas'
};

/**
 * Executada automaticamente pelo gatilho de envio do formulário.
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
 * Prepara as colunas auxiliares, a lista de tarefas e o gatilho.
 * Execute esta função uma vez após copiar o projeto.
 */
function configurarAutomacao() {
  const planilha = SpreadsheetApp.getActive();
  const aba = planilha.getSheetByName(CONFIG.NOME_ABA);

  if (!aba) {
    throw new Error(
      'A aba "' + CONFIG.NOME_ABA + '" não foi encontrada. ' +
      'Confira o nome definido em CONFIG.'
    );
  }

  garantirColuna_(aba, CONFIG.COLUNA_STATUS);
  garantirColuna_(aba, CONFIG.COLUNA_ID_TAREFA);
  obterOuCriarListaDeTarefas_();

  const gatilhoExiste = ScriptApp.getProjectTriggers().some(function(gatilho) {
    return gatilho.getHandlerFunction() === 'aoEnviarFormulario';
  });

  if (!gatilhoExiste) {
    ScriptApp.newTrigger('aoEnviarFormulario')
      .forSpreadsheet(planilha)
      .onFormSubmit()
      .create();
  }

  SpreadsheetApp.getUi().alert(
    'Automação configurada. Envie uma resposta de teste pelo formulário.'
  );
}

function processarLinha_(planilha, aba, numeroLinha) {
  const ultimaColuna = aba.getLastColumn();
  const cabecalhos = aba
    .getRange(1, 1, 1, ultimaColuna)
    .getDisplayValues()[0];
  const valores = aba
    .getRange(numeroLinha, 1, 1, ultimaColuna)
    .getValues()[0];
  const exibidos = aba
    .getRange(numeroLinha, 1, 1, ultimaColuna)
    .getDisplayValues()[0];

  const colunas = mapearColunas_(cabecalhos);
  const colunaStatus = localizarColuna_(colunas, [CONFIG.COLUNA_STATUS]);
  const colunaId = localizarColuna_(colunas, [CONFIG.COLUNA_ID_TAREFA]);

  try {
    const ideia = primeiroValor_(exibidos, colunas, [
      'Ideias',
      'Ideia',
      'Título da ideia'
    ]);
    const tipo = primeiroValor_(exibidos, colunas, [
      'Tipo de Ideias',
      'Tipo de ideias',
      'Tipo de produção'
    ]);
    const proximaAcao = primeiroValor_(exibidos, colunas, [
      'Próxima ação'
    ]);
    const observacoes = primeiroValor_(exibidos, colunas, [
      'Observações ou links',
      'Observações'
    ]);
    const anexos = primeiroValor_(exibidos, colunas, [
      'Anexar prints, PDFs ou documentos relacionados',
      'Anexos'
    ]);
    const colunaData = localizarColuna_(colunas, [
      'Data do prazo',
      'Prazo'
    ]);
    const dataPrazo = colunaData === -1 ? '' : valores[colunaData];

    if (!ideia) {
      throw new Error('A ideia não foi encontrada na linha enviada.');
    }

    if (!dataPrazo) {
      atualizarCelula_(aba, numeroLinha, colunaStatus, 'Sem prazo');
      atualizarCelula_(aba, numeroLinha, colunaId, '');
      return;
    }

    const lista = obterOuCriarListaDeTarefas_();
    const idExistente = colunaId === -1 ? '' : String(valores[colunaId] || '');
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
      due: formatarDataTarefa_(dataPrazo),
      status: 'needsAction'
    };

    let tarefaSalva;
    if (idExistente) {
      tarefaSalva = Tasks.Tasks.update(tarefa, lista.id, idExistente);
    } else {
      tarefaSalva = Tasks.Tasks.insert(tarefa, lista.id);
    }

    atualizarCelula_(aba, numeroLinha, colunaStatus, 'Tarefa criada');
    atualizarCelula_(aba, numeroLinha, colunaId, tarefaSalva.id);
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

function obterOuCriarListaDeTarefas_() {
  const resposta = Tasks.Tasklists.list({ maxResults: 100 });
  const listas = resposta.items || [];

  const existente = listas.find(function(lista) {
    return lista.title === CONFIG.NOME_LISTA_TAREFAS;
  });

  if (existente) {
    return existente;
  }

  return Tasks.Tasklists.insert({
    title: CONFIG.NOME_LISTA_TAREFAS
  });
}

function montarTituloCurto_(ideia) {
  const prefixo = '🟢 ';
  const texto = String(ideia).replace(/\s+/g, ' ').trim();
  const limiteTexto = CONFIG.LIMITE_TITULO - prefixo.length;

  if (texto.length <= limiteTexto) {
    return prefixo + texto;
  }

  return prefixo + texto.slice(0, limiteTexto - 1).trimEnd() + '…';
}

function montarNotas_(dados) {
  const secoes = [
    ['IDEIA', dados.ideia],
    ['TIPO', dados.tipo],
    [
      'PRÓXIMA AÇÃO',
      dados.proximaAcao && dados.proximaAcao.trim() !== '.'
        ? dados.proximaAcao
        : ''
    ],
    ['OBSERVAÇÕES E LINKS', dados.observacoes],
    ['ANEXOS', dados.anexos],
    ['PLANILHA', dados.planilha]
  ];

  return secoes
    .filter(function(secao) {
      return secao[1];
    })
    .map(function(secao) {
      return secao[0] + '\n' + secao[1];
    })
    .join('\n\n');
}

function formatarDataTarefa_(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);

  if (isNaN(data.getTime())) {
    throw new Error('A data do prazo não é válida.');
  }

  const dia = Utilities.formatDate(
    data,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  return dia + 'T00:00:00.000Z';
}

function mapearColunas_(cabecalhos) {
  const mapa = {};

  cabecalhos.forEach(function(cabecalho, indice) {
    mapa[normalizar_(cabecalho)] = indice;
  });

  return mapa;
}

function localizarColuna_(mapa, nomes) {
  for (let i = 0; i < nomes.length; i += 1) {
    const chave = normalizar_(nomes[i]);
    if (Object.prototype.hasOwnProperty.call(mapa, chave)) {
      return mapa[chave];
    }
  }

  return -1;
}

function primeiroValor_(valores, mapa, nomes) {
  const coluna = localizarColuna_(mapa, nomes);
  return coluna === -1 ? '' : String(valores[coluna] || '').trim();
}

function garantirColuna_(aba, nome) {
  const ultimaColuna = Math.max(aba.getLastColumn(), 1);
  const cabecalhos = aba
    .getRange(1, 1, 1, ultimaColuna)
    .getDisplayValues()[0];
  const existe = cabecalhos.some(function(cabecalho) {
    return normalizar_(cabecalho) === normalizar_(nome);
  });

  if (!existe) {
    aba.getRange(1, ultimaColuna + 1).setValue(nome);
  }
}

function atualizarCelula_(aba, linha, indiceColuna, valor) {
  if (indiceColuna !== -1) {
    aba.getRange(linha, indiceColuna + 1).setValue(valor);
  }
}

function normalizar_(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
