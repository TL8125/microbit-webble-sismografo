# Microbit Sismógrafo

Site estático para usar o micro:bit como um sismógrafo simples. O micro:bit envia leituras do acelerômetro por Bluetooth BLE UART, o navegador recebe via Web Bluetooth, desenha a onda em um `<canvas>` e permite baixar os dados em CSV.

```txt
micro:bit BLE UART -> site Web Bluetooth -> gráfico -> CSV
```

Repositório:

```txt
https://github.com/TL8125/microbit-webble-sismografo
```

Site publicado:

```txt
https://tl8125.github.io/microbit-webble-sismografo/
```

## Arquivos

```txt
index.html
style.css
app.js
diagnostics.html
diagnostics.js
microbit_ble_minimal_test.js
microbit_makecode_ble.js
README.md
.github/workflows/deploy.yml
```

## Configuração correta no MakeCode

Use esta ordem antes de testar o app completo:

1. Criar projeto novo no [MakeCode para micro:bit](https://makecode.microbit.org/).
2. Adicionar a extensão **Bluetooth**.
3. Aceitar remover a extensão **radio** se aparecer aviso.
4. Abrir **engrenagem -> Project Settings**.
5. Ativar **No Pairing Required**.
6. Colar primeiro o código de `microbit_ble_minimal_test.js`.
7. Baixar o `.hex` para o micro:bit.
8. Testar conexão no site usando `diagnostics.html`.
9. Só depois testar o código completo de `microbit_makecode_ble.js`.

Se o micro:bit mostrar carinha triste com código `020`, é provável falta de memória. Use a versão mínima, confirme a conexão BLE e só depois tente o sismógrafo completo.

## Código BLE mínimo

Cole `microbit_ble_minimal_test.js` no MakeCode para testar apenas BLE UART:

```js
let connected = 0

bluetooth.startUartService()

bluetooth.onBluetoothConnected(function () {
    connected = 1
    basic.showIcon(IconNames.Yes)
})

bluetooth.onBluetoothDisconnected(function () {
    connected = 0
    basic.clearScreen()
})

basic.showString("BLE")

basic.forever(function () {
    if (connected == 1) {
        bluetooth.uartWriteLine("wave:10")
    }
    basic.pause(500)
})
```

Esse código não usa extensão radio, não usa serial USB e envia apenas `wave:10` a cada 500 ms quando conectado.

## Código completo do sismógrafo

Depois que o BLE mínimo funcionar:

1. Abra o MakeCode.
2. Mantenha a extensão **Bluetooth** e **No Pairing Required**.
3. Cole `microbit_makecode_ble.js`.
4. Baixe para o micro:bit.
5. Deixe o micro:bit parado enquanto ele mostra `CAL`.

O código completo:

- usa `input.setAccelerometerRange(AcceleratorRange.OneG)`;
- chama `bluetooth.startUartService()`;
- envia `wave:<valor>` e `total:<valor>` com `bluetooth.uartWriteLine()`;
- começa com `sampleDelayMs = 100` para reduzir risco de travamento;
- atualiza a base lentamente para reduzir drift.

## Ordem de teste recomendada

```txt
1. Esquecer/remover pareamentos antigos do micro:bit no Windows/iPhone.
2. Reiniciar o micro:bit.
3. Testar primeiro no Chrome ou Edge do Windows.
4. Só depois testar no iPhone via Bluefy.
5. Se o micro:bit não aparecer, testar com código BLE mínimo.
6. Se ainda não aparecer, verificar se o projeto MakeCode está com No Pairing Required.
```

Passo a passo objetivo:

```txt
A. Testar código BLE mínimo no micro:bit.
B. Abrir diagnostics.html no Chrome/Edge.
C. Confirmar se micro:bit aparece.
D. Confirmar se conecta.
E. Confirmar se recebe wave:10.
F. Só depois testar o app principal.
```

## Diagnóstico BLE

Abra:

```txt
https://tl8125.github.io/microbit-webble-sismografo/diagnostics.html
```

Essa página é propositalmente mínima:

- botão **Abrir seletor BLE**;
- botão **Conectar UART**;
- logs na tela;
- dados recebidos em texto;
- nenhuma lógica de gráfico, CSV ou parser.

O app principal também tem o botão **Teste BLE mínimo** e um painel que mostra:

- se `navigator.bluetooth` existe;
- resultado de `navigator.bluetooth.getAvailability()`, quando disponível;
- se a página está em HTTPS ou localhost;
- navegador e plataforma detectados;
- nome e ID do dispositivo escolhido;
- etapa atual da conexão;
- último erro completo com `name`, `message` e `stack`.

## Web Bluetooth e scan permissivo

O projeto usa scan permissivo para diagnóstico:

```js
navigator.bluetooth.requestDevice({
  acceptAllDevices: true,
  optionalServices: ["6e400001-b5a3-f393-e0a9-e50e24dcca9e"]
})
```

Isso evita depender de filtros por nome ou serviço no seletor. Depois da escolha manual, o site tenta acessar o UART:

```js
const service = await server.getPrimaryService(UART_SERVICE)
```

UUIDs usados:

```txt
UART Service: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
UART RX:      6E400002-B5A3-F393-E0A9-E50E24DCCA9E
UART TX:      6E400003-B5A3-F393-E0A9-E50E24DCCA9E
```

Web Bluetooth não permite listar dispositivos automaticamente. O usuário precisa escolher um dispositivo no seletor do navegador.

Se `acceptAllDevices: true` não mostra o micro:bit, o problema provavelmente está no micro:bit anunciando BLE, no navegador/app BLE, em permissão do sistema ou em pareamento antigo, não no gráfico.

## Rodar localmente

Use `localhost`, porque Web Bluetooth exige contexto seguro.

```bash
cd microbit-webble-sismografo
python -m http.server 8000
```

Abra:

```txt
http://localhost:8000
```

No Windows, se `python` não estiver disponível:

```bash
py -m http.server 8000
```

## Usar no PC ou Android

1. Abra no Chrome ou Edge.
2. Teste primeiro `diagnostics.html`.
3. Clique em **Abrir seletor BLE**.
4. Escolha o micro:bit manualmente.
5. Clique em **Conectar UART**.
6. Confirme se recebe `wave:10` com o firmware mínimo.
7. Volte ao app principal.

No GitHub Pages, a página já está em HTTPS.

## Usar no iPhone

Safari iOS comum pode não funcionar com Web Bluetooth. Use um navegador com Web BLE, como Bluefy.

Fluxo:

1. Instale e abra o Bluefy.
2. Acesse a URL publicada do site.
3. Teste primeiro `diagnostics.html`.
4. Só depois use o app principal.

## CSV

O botão **Baixar CSV** gera:

```csv
timestamp_ms,key,raw_value,corrected_value
```

O app mantém no máximo 20.000 linhas em memória. Quando passa disso, remove as mais antigas.

## Deploy no GitHub Pages

Crie o repositório e envie:

```bash
git init
git add .
git commit -m "create microbit web ble seismograph"
git branch -M main
gh repo create microbit-webble-sismografo --public --source=. --remote=origin --push
```

Para esta revisão:

```bash
git add .
git commit -m "improve bluetooth diagnostics and microbit connection"
git push
```

Depois ative:

```txt
GitHub repository -> Settings -> Pages -> Source: GitHub Actions
```

O workflow `.github/workflows/deploy.yml` publica o conteúdo estático sem etapa de build.

## Deploy manual

- **Netlify Drop**: arraste a pasta do projeto para o painel do Netlify Drop.
- **Vercel**: importe o repositório e use deploy estático sem build.
- **GitHub Pages via branch main**: em Pages, escolha `Deploy from a branch`, branch `main`, pasta `/root`.

## Problemas comuns

| Problema | Causa provável | Solução |
| --- | --- | --- |
| micro:bit mostra carinha triste | panic code | anotar número e reduzir taxa de envio |
| micro:bit mostra carinha triste 020 | falta de memória no firmware | usar `microbit_ble_minimal_test.js` |
| site diz que Bluetooth não existe | navegador sem Web Bluetooth | usar Chrome/Edge ou Bluefy |
| micro:bit não aparece | BLE não ativo/pareamento | remover pareamentos antigos e revisar MakeCode |
| conecta mas não recebe dados | UART não iniciado | conferir `bluetooth.startUartService()` |
| falha GATT / NetworkError | pareamento antigo ou BLE travado | esquecer dispositivo, reiniciar micro:bit e navegador |
| onda muito ruidosa | micro:bit solto | prender em base firme |
| linha reta | sem vibração ou código não enviando | testar `diagnostics.html` com firmware mínimo |
| iPhone não funciona no Safari | Safari não suporta Web Bluetooth comum | usar Bluefy |

Se o micro:bit mostrar carinha triste, anote o número exibido depois dela. Para reduzir risco de panic, mantenha `sampleDelayMs = 100` no começo. Depois teste `50` ou `20` ms somente se estiver estável.

## Como validar localmente

```bash
cd microbit-webble-sismografo
node --check app.js
node --check diagnostics.js
python -m http.server 8000
```

Checklist:

- Abrir `http://localhost:8000`.
- Abrir `http://localhost:8000/diagnostics.html`.
- Conferir que os botões aparecem.
- Conferir que o status mostra suporte ou falta de suporte a Web Bluetooth.
- Confirmar que o seletor usa escolha manual do dispositivo.
- Testar firmware mínimo e receber `wave:10`.
- Só depois testar gráfico, calibração e CSV no app principal.
