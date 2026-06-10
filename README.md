# Microbit Sismógrafo

Site estático para visualizar dados do micro:bit via Bluetooth BLE UART em um gráfico estilo MakeCode Data Viewer.

```txt
micro:bit BLE UART -> Web Bluetooth -> gráfico Canvas -> CSV
```

Site publicado:

```txt
https://tl8125.github.io/microbit-webble-sismografo/
```

## Visual do gráfico

- Página clara, inspirada no MakeCode Data Viewer/console.
- Gráfico com fundo cinza claro e grade vertical.
- `wave` em azul.
- `total` em rosa/vermelho quando existir.
- Badges laranja para valores atuais.
- Painel `Teste UART` recolhível com o último pacote BLE.

## Janela temporal

O gráfico usa janela temporal, não quantidade fixa de amostras:

```txt
50 Hz
20 ms por amostra
janela visível: 10 segundos
aproximadamente 500 amostras visíveis
```

Cada amostra do gráfico guarda timestamp:

```js
{ t: performance.now(), value: valor }
```

O app mantém visíveis apenas amostras dentro dos últimos 10 segundos:

```js
samples = samples.filter(s => now - s.t <= visibleSeconds * 1000)
```

As amostras antigas ficam transparentes progressivamente. Amostras novas aparecem fortes.

## BLE UART

UUIDs usados:

```js
const UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
const UART_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
const UART_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
```

O app escolhe automaticamente a característica que recebe dados:

```js
const chars = await service.getCharacteristics()
txChar = chars.find(c => c.properties.notify || c.properties.indicate)
```

Isso evita escutar a característica errada quando o micro:bit expõe `indicate` em vez de `notify`.

## Dados aceitos

O parser aceita:

```txt
wave:10
wave:-10
vib:10
total:10
```

Também aceita pacotes quebrados e separadores `\n`, `\r` e `\r\n`.

## Micro:bit

Use `microbit_makecode_ble.js` no MakeCode com a extensão Bluetooth e **No Pairing Required**.

Para teste simples, use `microbit_ble_test.js`, que alterna:

```txt
wave:10
wave:-10
```

## Rodar localmente

```bash
cd microbit-webble-sismografo
node --check app.js
python -m http.server 8000
```

Abra:

```txt
http://localhost:8000
```

## Testar no Bluefy

1. Grave `microbit_ble_test.js` no micro:bit.
2. Abra `https://tl8125.github.io/microbit-webble-sismografo/` no Bluefy.
3. Toque em `Conectar micro:bit`.
4. Abra `Teste UART` para confirmar `Último pacote BLE`.
5. O gráfico deve mostrar a onda azul atualizando.

## CSV

O botão **Baixar CSV** gera:

```csv
timestamp_ms,key,raw_value,corrected_value
```

O app mantém no máximo 20.000 linhas para download.

## Deploy

```bash
git add .
git commit -m "improve MakeCode style graphs with 50Hz fading window"
git push
```

O GitHub Pages publica pelo workflow em `.github/workflows/deploy.yml`.
