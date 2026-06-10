let v = 10

bluetooth.startUartService()
basic.clearScreen()

basic.forever(function () {
    bluetooth.uartWriteLine("wave:" + v)
    v = 0 - v
    basic.pause(500)
})
