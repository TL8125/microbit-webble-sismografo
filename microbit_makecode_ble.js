// Cole este código no editor JavaScript do MakeCode.
// Requer a extensão Bluetooth.

let sampleDelayMs = 100
let connected = false

let baseX = 0
let baseY = 0
let baseZ = 0

bluetooth.onBluetoothConnected(function () {
    connected = true
    basic.showIcon(IconNames.Yes)
})

bluetooth.onBluetoothDisconnected(function () {
    connected = false
    basic.showIcon(IconNames.No)
})

function calibrateBase(samples: number) {
    basic.showString("CAL")

    let sumX = 0
    let sumY = 0
    let sumZ = 0

    for (let i = 0; i < samples; i++) {
        sumX += input.acceleration(Dimension.X)
        sumY += input.acceleration(Dimension.Y)
        sumZ += input.acceleration(Dimension.Z)
        basic.pause(20)
    }

    baseX = sumX / samples
    baseY = sumY / samples
    baseZ = sumZ / samples
    basic.showIcon(IconNames.No)
}

input.setAccelerometerRange(AcceleratorRange.OneG)
bluetooth.startUartService()
calibrateBase(50)

basic.forever(function () {
    let x = input.acceleration(Dimension.X)
    let y = input.acceleration(Dimension.Y)
    let z = input.acceleration(Dimension.Z)

    let dx = x - baseX
    let dy = y - baseY
    let dz = z - baseZ
    let wave = dz
    let total = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (connected) {
        bluetooth.uartWriteLine("wave:" + Math.round(wave))
        bluetooth.uartWriteLine("total:" + Math.round(total))
    }

    // Atualiza a base devagar para reduzir drift sem apagar vibrações curtas.
    let driftAlpha = 0.01
    baseX = baseX + dx * driftAlpha
    baseY = baseY + dy * driftAlpha
    baseZ = baseZ + dz * driftAlpha

    basic.pause(sampleDelayMs)
})
