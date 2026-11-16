// Route for tools/gen-track.mjs rockies. Default export: (Turtle) => turtle.done()
export default function route(Turtle) {
    const t = Turtle(42);
    t.straight(120, 0.01);
    // lakeshore sweepers
    t.arc(320, 24, 0.012).arc(260, -34, 0.014).arc(380, 28, 0.01).straight(60, 0.01).arc(300, -26, 0.012).arc(220, 30, 0.01).straight(40, 0.01);
    t.mark('overpass-start').straight(140, 0.03).mark('overpass-end');
    // forest straight with a gentle drift, avalanche gallery on the straight
    t.straight(140, 0.03).arc(900, -8, 0.03).straight(120, 0.03).mark('gallery-start').straight(220, 0.03).mark('gallery-end');
    t.straight(60, 0.03).arc(500, 14, 0.05).arc(450, -12, 0.06).straight(200, 0.06).arc(260, 22, 0.06).arc(300, -24, 0.06).straight(120, 0.06);
    // four stacked hairpins
    t.mark('hairpins-start');
    t.straight(140, 0.075).arc(46, 180, 0.08).straight(170, 0.08).arc(46, -180, 0.08).straight(170, 0.08).arc(46, 180, 0.08).straight(170, 0.08).arc(46, -180, 0.08);
    t.straight(200, 0.04).mark('hairpins-end');
    // fast bench, then the gorge bridge on flat ground
    t.arc(500, -18, 0.0).arc(500, 14, 0.0).straight(300, 0).mark('bridge-run-start').straight(380, 0).mark('bridge-run-end').straight(100, 0);
    // snowfield pass
    t.arc(420, 22, 0.05).arc(380, -26, 0.055).straight(240, 0.055).arc(300, 20, 0.05).arc(320, -24, 0.045).straight(320, 0.065).arc(500, 10, 0.05).straight(120, 0.03);
    t.straight(480, 0.0);
    return t.done();
}
