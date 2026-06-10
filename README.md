# Microbit Sismógrafo

Site estático para usar o micro:bit como um sismógrafo simples. O micro:bit envia leituras do acelerômetro por Bluetooth BLE UART, o navegador recebe via Web Bluetooth, desenha a onda em um `<canvas>` e permite baixar os dados em CSV.

```txt
micro:bit BLE UART -> site Web Bluetooth -> gráfico -> CSV
```

## Arquivos

```txt
index.html
style.css
app.js
microbit_makecode_ble.js
README.md
.github/workflows/deploy.yml
```

## Como programar o micro:bit

1. Abra [MakeCode para micro:bit](https://makecode.microbit.org/).
2. Crie um projeto novo.
3. Vá em **Extensions** e adicione a extensão **Bluetooth**.
4. Se o MakeCode pedir para remover **radio**, confirme. Este projeto usa BLE UART; a extensão radio não deve ficar junto.
5. Troque para a aba **JavaScript**.
6. Copie o conteúdo de `microbit_makecode_ble.js` e cole no MakeCode.
7. Baixe o `.hex` e grave no micro:bit.
8. Deixe o micro:bit parado enquanto ele mostra `CAL`.

O código usa:

```txt
bluetooth.startUartService()
bluetooth.uartWriteLine()
```

Ele não usa `radio` e não usa `serial.redirectToUSB()`.

## Dados enviados

O micro:bit envia linhas de texto:

```txt
wave:12
total:34
```

- `wave`: eixo Z corrigido pela base calibrada no micro:bit.
- `total`: intensidade total aproximada da vibração.

No site, o botão **Calibrar app** calcula a média das últimas 200 amostras brutas de `wave`, salva como `zeroOffset`, limpa o gráfico e passa a mostrar a onda corrigida.

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

1. Abra o site no Chrome ou Edge.
2. Clique em **Conectar micro:bit**.
3. Escolha o dispositivo `BBC micro:bit` ou `micro:bit`.
4. Aguarde o status indicar conexão.
5. Faça uma vibração leve na mesa e observe o gráfico.

## Usar no iPhone

Safari iOS comum não oferece Web Bluetooth para este fluxo. Use um browser com Web BLE, como Bluefy.

Fluxo:

1. Instale e abra o Bluefy.
2. Acesse a URL publicada do site.
3. Toque em **Conectar micro:bit**.
4. Escolha o micro:bit na lista.

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
| site diz que Bluetooth não existe | navegador sem Web Bluetooth | usar Chrome/Edge ou Bluefy |
| micro:bit não aparece | BLE não ativo/pareamento | revisar código e modo Bluetooth |
| conecta mas não recebe dados | UART não iniciado | conferir `bluetooth.startUartService()` |
| onda muito ruidosa | micro:bit solto | prender em base firme |
| linha reta | sem vibração ou código não enviando | testar batida leve na mesa |
| iPhone não funciona no Safari | Safari não suporta Web Bluetooth comum | usar Bluefy |

Se o micro:bit mostrar carinha triste, anote o número exibido depois dela. Para reduzir risco de panic, mantenha `sampleDelayMs = 100` no começo. Depois teste `50` ou `20` ms somente se estiver estável.

## Observações técnicas

- O site usa os UUIDs Nordic UART padrão usados pelo micro:bit:

```txt
UART Service: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
RX Characteristic: 6E400002-B5A3-F393-E0A9-E50E24DCCA9E
TX Characteristic: 6E400003-B5A3-F393-E0A9-E50E24DCCA9E
```

- O parser aceita `wave`, `vib` e `total`.
- Valores negativos são aceitos.
- Decimal com ponto ou vírgula é aceito.
- Linhas inválidas são ignoradas.
- O buffer parcial é limpo se passar de 500 caracteres.
- O gráfico mantém as últimas 1000 amostras de `wave`.
- A escala é automática pela maior amplitude visível.

## Como validar localmente

```bash
cd microbit-webble-sismografo
python -m http.server 8000
```

Checklist:

- Abrir `http://localhost:8000`.
- Conferir que os botões aparecem.
- Conferir que o status mostra suporte ou falta de suporte a Web Bluetooth.
- Conectar o micro:bit.
- Clicar em **Calibrar app** com o micro:bit parado.
- Fazer vibração leve e observar o gráfico.
- Clicar em **Baixar CSV**.
