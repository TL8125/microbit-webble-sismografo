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
