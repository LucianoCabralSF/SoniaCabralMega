# Sonia Cabral Mega

Frontend estático do sistema do salão Sonia Cabral, publicado na Vercel e integrado ao backend em Google Apps Script.

## Estrutura

- `index.html`: aplicação principal
- `rules.js`: regras puras usadas pelo navegador
- `Código.gs` e `Regras.gs`: backend do Google Apps Script
- `vercel.json`: configuração de deploy e cabeçalhos de segurança
- `tests/`: testes automatizados e ambiente visual com dados fictícios

## Publicação segura

Sempre publique o backend antes do frontend. A nova interface depende das regras e rotas novas do Apps Script.

1. Rode `npm test` e confirme que todos os testes passaram.
2. No projeto Apps Script, envie `Código.gs`, `Regras.gs` e `appsscript.json`. Antes de enviar, `clasp status` deve listar os três arquivos.
3. Crie uma nova versão do Web App sem substituir ou apagar a versão anterior. Confirme que a ação pública de configuração responde e que a URL continua correta.
4. Só então publique o frontend na Vercel, com framework preset `Other`, build command vazio e output directory vazio.
5. Faça uma verificação curta: login, abertura da agenda, conclusão de um atendimento fictício controlado e conferência do lançamento no caixa.

Se a validação falhar, reverta primeiro a Vercel para o deploy anterior e depois selecione a versão anterior do Web App no Apps Script. Não apague as versões anteriores até a nova versão passar pela revisão operacional.

## Central de Relacionamento

A Central reúne retornos próximos, clientes atrasados, aniversariantes e campanhas. A operação usa quatro etapas: `contatada`, `respondeu`, `agendou` e `retornou`. O histórico de cada oportunidade registra as mudanças para facilitar acompanhamento e auditoria.

- Retornos entram na fila de atenção 7 dias antes da data recomendada e passam para recuperação depois de 15 dias de atraso.
- Ao concluir um atendimento, informe a próxima data recomendada ou marque explicitamente que não há retorno.
- O WhatsApp é assistido: a mensagem pode ser revisada antes de abrir o aplicativo e a etapa só muda para `contatada` depois da confirmação humana de envio.
- Clientes com bloqueio de contato ou telefone inválido continuam visíveis no histórico, mas não podem receber mensagens nem integrar públicos de campanha.
- Campanhas usam um público explicitamente selecionado e não duplicam oportunidades quando a geração é repetida.
- Os indicadores mostram oportunidades elegíveis, contatos, respostas, agendamentos e retornos. Valores vazios são apresentados como zero.

Para revisar localmente sem acessar dados reais, rode `npm run preview:fixture` e entre com a senha `fixture`.

## DRE gerencial anual

A DRE anual é uma síntese gerencial por regime de caixa: considera somente entradas e saídas efetivamente registradas no Caixa no ano escolhido. Ela não substitui uma demonstração contábil oficial e não antecipa parcelas futuras de fiado ou planejamento.

As linhas seguem esta leitura:

- Receitas de serviços, produtos e outras receitas formam a receita bruta.
- Deduções, estornos e impostos reduzem a receita líquida.
- Custos variáveis reduzem a margem de contribuição.
- Pessoal, estrutura, outras despesas operacionais e resultado financeiro formam o resultado líquido gerencial.
- Retiradas dos proprietários ficam separadas do resultado gerencial e aparecem no resultado após retiradas.
- Movimentos sem uma regra segura aparecem em “Movimentos a classificar” e deixam o relatório marcado como “DRE provisória”.

Cada valor mensal e o total anual são botões: ao abrir uma célula, o sistema mostra os lançamentos que compõem exatamente aquele valor. Movimentos pendentes podem ser classificados individualmente; opcionalmente, um padrão pode ser criado para os próximos lançamentos semelhantes. A classificação altera somente a categoria da DRE, nunca data, tipo ou valor do Caixa. Use “Fora da DRE” apenas por decisão explícita.

O quadro de conciliação compara, por caminhos independentes, a variação elegível do Caixa com o total explicado pela DRE, retiradas e pendências. Diferença técnica diferente de zero exige revisão antes de usar o relatório para decisão.

## Backend

A URL do backend Apps Script está configurada em `window.__API_URL__`, no `index.html`. Os arquivos `Código.gs` e `Regras.gs` devem estar no mesmo projeto Apps Script; publicar somente um deles deixa o backend incompleto.

Em instalações existentes, a senha em texto puro é migrada automaticamente para hash com salt no primeiro login válido. Em uma instalação nova, execute uma vez pelo editor do Apps Script:

```js
definirSenhaInicial('uma senha segura com 8 ou mais caracteres')
```

Depois dessa inicialização, a senha só deve ser alterada pela tela de configurações do sistema.

## Verificação local

```powershell
npm test
npm run preview:fixture
```

O segundo comando abre um servidor local com dados fictícios. Ele não acessa a planilha nem o backend real.

## Observações
Caso a URL do Web App do Apps Script mude, basta atualizar a constante:

```js
window.__API_URL__
```
