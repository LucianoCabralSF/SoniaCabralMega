# Sonia Cabral — Design de correção e endurecimento

## Objetivo

Corrigir as falhas confirmadas de segurança, integridade financeira, planejamento, datas, cache, UX e acessibilidade sem trocar a infraestrutura atual nem acessar dados reais.

## Arquitetura escolhida

O frontend estático continuará publicado na Vercel e o backend continuará no Google Apps Script com Google Sheets. Regras puras e sensíveis serão extraídas para `rules.js` (frontend) e `Regras.gs` (backend), permitindo testes determinísticos sem navegador ou planilha. O restante da interface permanecerá em `index.html` para evitar uma refatoração ampla nesta entrega.

## Autenticação e sessões

O frontend enviará login por POST com `{ action: 'login', senha, lembrar }`. O backend armazenará somente hash SHA-256 com salt em Script Properties e migrará a senha legada após um login válido. Respostas de configuração serão sanitizadas. Tokens carregarão uma versão de autenticação; a troca de senha incrementará a versão e revogará tokens persistentes. Sessões não persistentes usarão `sessionStorage`.

Tentativas inválidas serão limitadas em uma janela curta. A troca de senha exigirá a senha atual e senha nova de ao menos oito caracteres. O logout revogará o token quando possível e sempre limpará dados locais.

## Proteção de conteúdo

Todo dado originado de planilha, formulário ou API será tratado como texto. Templates dinâmicos usarão escape de HTML e atributos. Identificadores colocados em atributos ou handlers serão codificados. Headers de segurança adicionais serão configurados, reconhecendo que scripts e handlers inline impedem uma CSP sem `unsafe-inline` nesta arquitetura.

## Regras financeiras

Valores serão convertidos para centavos antes de comparação e divisão. A divisão de parcelas produzirá uma lista cuja soma é exatamente igual ao saldo. O pagamento será validado contra saldo e, quando associado a parcela, contra o valor aberto exato. Cada submissão terá uma chave de idempotência registrada no lançamento de caixa.

O backend fará validações antes da primeira escrita. Em fluxos compostos, valores anteriores necessários ao rollback serão capturados e restaurados se uma etapa posterior falhar.

## Planejamento e datas

Edição sem parcelas pagas atualizará o planejamento e regenerará apenas as parcelas ainda não pagas. Exclusão será bloqueada quando houver histórico pago. A função de vencimento mensal criará a data no primeiro dia do mês-alvo e aplicará `min(diaPreferido, últimoDiaDoMês)`, impedindo que fevereiro seja pulado.

Datas serão aceitas somente quando representarem um dia real nos formatos `YYYY-MM-DD` ou `DD/MM/YYYY`.

## Cache e estado de sincronização

Timeouts usarão um estado inequívoco `network_error`. `loadAll` só persistirá cache depois que o conjunto mínimo de respostas tiver sucesso. Cache antigo poderá ser exibido como fallback, sempre acompanhado de indicador visível e acessível de estado/horário. Logout apagará todas as chaves `sc_*`.

## UX e acessibilidade

O layout visual será preservado. Será permitido zoom; foco por teclado ficará visível; campos dinâmicos ganharão nome acessível por associação automática ao texto `.lbl`; botões de ícone terão rótulos; seletores segmentados terão `aria-pressed`; toast terá live region; modal e drawer terão semântica de diálogo. A visão mensal continuará sendo panorama, mas receberá textos/títulos acessíveis e melhor legibilidade.

## PWA

O cache será versionado. Apenas respostas HTTP bem-sucedidas serão armazenadas. O fallback para `index.html` ocorrerá apenas em navegações; recursos ausentes receberão erro em vez de HTML com MIME incorreto.

## Testes

A suíte usará `node:test` e `assert` sem downloads. Cobrirá:

- validação e conversão de datas;
- vencimento mensal nos dias 29–31;
- divisão exata em centavos;
- rejeição de pagamento parcial associado a parcela e de pagamento acima do saldo;
- idempotência;
- remoção da senha das respostas/configuração local;
- login somente por POST e respeito ao checkbox;
- regressão da edição/exclusão de planejamento;
- presença de rótulos e políticas básicas de acessibilidade;
- sintaxe dos scripts do frontend e backend.

## Critérios de conclusão

- Todos os testes novos passam e foram observados falhando antes das respectivas implementações.
- Sintaxe de `index.html`, `rules.js`, `Regras.gs` e `Código.gs` é válida.
- Fluxos principais são exercitados com backend simulado em desktop e 390×844 px.
- Nenhuma chamada grava dados reais.
- `decisões.md` descreve escolhas e riscos residuais.
