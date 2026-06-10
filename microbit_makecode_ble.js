let baseZ = 0
let z = 0
let wave = 0
let sampleDelayMs = 50

input.setAccelerometerRange(AcceleratorRange.OneG)
bluetooth.startUartService()

basic.clearScreen()

for (let i = 0; i < 100; i++) {
    baseZ += input.acceleration(Dimension.Z)
    basic.pause(10)
}

baseZ = Math.idiv(baseZ, 100)

basic.forever(function () {
    z = input.acceleration(Dimension.Z)
    wave = z - baseZ

    baseZ = Math.idiv(baseZ * 999 + z, 1000)

    bluetooth.uartWriteLine("wave:" + wave)

    basic.pause(sampleDelayMs)
})
