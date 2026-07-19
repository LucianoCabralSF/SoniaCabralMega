# Sonia Cabral — DRE Gerencial Anual por Caixa

## Objetivo

Oferecer uma síntese financeira anual que mostre a formação do resultado da empresa, a evolução de janeiro a dezembro e os lançamentos que compõem cada valor. O relatório será gerencial, não uma demonstração contábil oficial.

## Decisões aprovadas

- Regime de caixa: somente valores efetivamente recebidos ou pagos entram no relatório.
- Visualização com colunas de janeiro a dezembro e total anual.
- Classificação automática dos lançamentos, com correção explícita dos não reconhecidos.
- Retiradas dos proprietários exibidas abaixo do resultado, sem serem tratadas como despesa operacional.
- O financeiro mensal atual será preservado.

Não fazem parte desta versão: regime de competência, balanço patrimonial, fluxo de caixa projetado, comparação automática entre anos, rateio contábil, conciliação bancária ou escrituração fiscal.

## Arquitetura e limites

A DRE será um módulo de leitura e classificação sobre a estrutura `caixa`. O cálculo ficará isolado das rotinas de gravação do caixa e não alterará valor, tipo, data, forma de pagamento ou histórico de um lançamento.

O backend fornecerá três responsabilidades separadas:

1. classificar um lançamento em uma linha da DRE;
2. agregar valores mensais e anuais;
3. listar os lançamentos de uma célula para conferência.

O frontend terá uma entrada “DRE Anual”, independente do extrato mensal. A ausência ou falha desse relatório não impedirá o uso do caixa.

## Modelo de classificação

`caixa` receberá o campo opcional `dreCategoria`. Quando preenchido, ele prevalecerá sobre a classificação automática, sem modificar os demais campos. Os valores aceitos serão `receita_servicos`, `receita_produtos`, `outras_receitas`, `deducoes`, `custos_variaveis`, `despesas_pessoal`, `despesas_estrutura`, `despesas_operacionais`, `resultado_financeiro`, `retirada` e `fora_dre`.

Uma nova estrutura `dre_mapeamento` armazenará regras por combinação de tipo do movimento, categoria atual e tipo do item. Cada regra terá identificador, critérios, linha de destino, situação ativa e metadados de auditoria.

A ordem de decisão será:

1. retirada pessoal, identificada por `isRetirada` ou categoria equivalente;
2. classificação explícita do lançamento;
3. regra cadastrada em `dre_mapeamento`;
4. regras seguras do sistema baseadas no tipo de item;
5. `A classificar`.

Mapeamentos iniciais seguros:

- atendimento ou serviço recebido: receita de serviços;
- produto vendido: receita de produtos;
- aluguel e manutenção: despesas de estrutura;
- material e compra de produto: custos variáveis;
- salário: despesas com pessoal;
- retirada pessoal: movimentação dos proprietários;
- categorias genéricas como “Outros” e “Obrigação programada”: `A classificar`, salvo quando houver referência que determine a origem com segurança.

Ao corrigir uma classificação, a usuária poderá escolher entre alterar somente aquele lançamento ou também salvar o mapeamento como padrão para movimentos futuros equivalentes. Nenhuma classificação em massa será aplicada sem confirmação explícita.

## Critério de realização

Uma linha ativa de `caixa` representa valor realizado. Portanto:

- entradas são reconhecidas na data em que aparecem no caixa;
- saídas são reconhecidas na data do pagamento;
- parcelas de crediário só entram quando recebidas e registradas no caixa;
- parcelas planejadas só entram quando pagas e registradas no caixa;
- saldos iniciais e transferências internas ficam fora da DRE quando identificados por classificação explícita ou regra segura como `fora_dre`; na dúvida, o movimento vai para `A classificar`;
- estornos pagos serão classificados como dedução de receita;
- movimentos excluídos logicamente não entram no cálculo.

Os valores serão processados em centavos para evitar divergências de arredondamento.

## Estrutura da DRE

A tabela terá as seguintes linhas, com subtotal destacado:

1. Receita bruta de serviços
2. Receita bruta de produtos
3. Outras receitas operacionais
4. (-) Deduções, estornos e impostos sobre vendas
5. **Receita líquida**
6. (-) Custos variáveis, produtos utilizados e comissões
7. **Margem de contribuição**
8. (-) Despesas com pessoal
9. (-) Aluguel, água, energia, manutenção e estrutura
10. (-) Marketing, administração e outras despesas operacionais
11. (+/-) Receitas e despesas financeiras
12. **Resultado líquido gerencial**
13. Retiradas dos proprietários
14. **Resultado após retiradas**, apresentado como conciliação de caixa e não como resultado operacional
15. Movimentos a classificar

As fórmulas serão:

- receita líquida = receitas brutas e outras receitas − deduções;
- margem de contribuição = receita líquida − custos variáveis;
- resultado líquido gerencial = margem de contribuição − despesas operacionais ± resultado financeiro;
- resultado após retiradas = resultado líquido gerencial − retiradas.

`A classificar` não será silenciosamente somado a uma linha arbitrária. Enquanto houver qualquer movimento não classificado, a tela mostrará “DRE provisória”. A quantidade, o total de entradas, o total de saídas e o saldo líquido não classificado ficarão visíveis por mês e no ano.

## Interface e navegação

A tela conterá:

- seletor de ano válido;
- cartões de faturamento anual, resultado gerencial, margem percentual, melhor mês e pior mês;
- tabela com janeiro a dezembro e total anual;
- primeira coluna fixa e rolagem horizontal em telas estreitas;
- gráfico mensal de receitas, despesas e resultado;
- aviso e atalho para classificar pendências;
- detalhamento ao selecionar qualquer célula calculada.

O detalhamento mostrará data, descrição, categoria original, classificação da DRE, tipo e valor. A soma do detalhamento deverá ser idêntica à célula selecionada. Subtotais mostrarão os movimentos das linhas que os compõem, sem duplicar lançamentos.

Melhor e pior mês serão definidos pelo resultado líquido gerencial, considerando somente meses com pelo menos um movimento elegível. Se o ano não tiver movimento, ambos exibirão `—`. Margem anual será `resultado líquido gerencial ÷ receita líquida`; quando a receita líquida for zero, será exibido zero.

## Conciliação

O relatório exibirá uma seção de conferência com:

- entradas elegíveis do caixa;
- saídas operacionais e financeiras elegíveis;
- retiradas;
- movimentos excluídos, como saldos e transferências;
- movimentos a classificar;
- diferença de conciliação.

A conferência será calculada por dois caminhos independentes e seguirá estas equações:

- saldo não classificado = entradas não classificadas − saídas não classificadas;
- variação bruta elegível = soma das entradas elegíveis do caixa − soma das saídas elegíveis do caixa;
- total explicado pela DRE = resultado após retiradas + saldo não classificado;
- diferença técnica = variação bruta elegível − total explicado pela DRE.

A diferença técnica deverá ser sempre zero; valor diferente de zero indica falha de cálculo ou dado inconsistente. A DRE será provisória sempre que existir movimento a classificar, mesmo que a diferença técnica seja zero.

## Validação e tratamento de falhas

- O ano precisa ser inteiro entre 1900 e 2200.
- Categorias aceitas serão enumeradas no backend; texto livre não poderá criar linhas arbitrárias.
- Reclassificação exigirá lançamento existente e manterá trilha de atualização.
- Exclusões lógicas serão respeitadas em todos os cálculos e detalhamentos.
- Uma falha de classificação não impedirá o relatório: o movimento irá para `A classificar`.
- Uma falha de rede manterá o último relatório visível com indicação de desatualização.
- Dados vindos da planilha serão tratados como texto ao serem renderizados.

## Testes

A cobertura deverá incluir:

- separação de receitas de serviços, produtos e outras receitas;
- mapeamento das categorias de saída existentes;
- precedência de retirada, classificação explícita e mapeamento;
- lançamentos desconhecidos em `A classificar`;
- estornos como dedução;
- exclusão de saldos iniciais, transferências e registros apagados;
- crediário e planejamento apenas no efetivo recebimento ou pagamento;
- cálculo em centavos de cada subtotal, mês e total anual;
- viradas de mês, ano e datas no fuso configurado;
- melhor e pior mês, inclusive com meses negativos ou sem movimento;
- margem com receita zero;
- igualdade entre célula e detalhamento;
- diferença técnica de conciliação igual a zero com ou sem pendências de classificação;
- marcação provisória sempre que existir ao menos um movimento não classificado;
- tabela utilizável em desktop e celular, com navegação por teclado.

## Critérios de aceitação

- A seleção de um ano produz 12 colunas mensais e um total anual.
- Os subtotais obedecem às fórmulas documentadas e usam centavos.
- Retiradas não reduzem o resultado líquido gerencial e aparecem separadamente.
- Parcelas futuras não entram antes do efetivo pagamento ou recebimento.
- Todo movimento elegível aparece em uma linha da DRE ou em `A classificar`.
- Relatório com pendências fica claramente marcado como provisório.
- O detalhamento de uma célula soma exatamente o valor exibido.
- Classificar um lançamento não altera seu valor, tipo, data ou histórico financeiro.
- O financeiro mensal continua apresentando os mesmos dados e comportamentos atuais.
