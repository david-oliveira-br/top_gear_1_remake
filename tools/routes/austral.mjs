// Route for tools/gen-track.mjs austral (Carretera Austral). Default export: (Turtle) => turtle.done()
export default function route(Turtle) {
    const t = Turtle(25);
    t.straight(120, 0.008);
    // turquoise lake shore sweepers
    t.arc(360, 22, 0.012).arc(300, -30, 0.014).arc(420, 24, 0.012).straight(60, 0.012).arc(320, -22, 0.012).arc(260, 28, 0.012).straight(80, 0.012).arc(450, -20, 0.014).arc(340, 26, 0.014).arc(500, -16, 0.014).straight(80, 0.014);
    // wooden bridge 1 over the Rio Cisnes (flat)
    t.straight(60, 0).mark('bridge1-start').straight(200, 0).mark('bridge1-end').straight(60, 0);
    // rainforest esses R70..110
    t.arc(110, 52, 0.022).arc(90, -66, 0.022).straight(50, 0.022).arc(100, 60, 0.024).arc(80, -72, 0.024).straight(50, 0.022).arc(110, 58, 0.022).arc(70, -64, 0.024).straight(60, 0.022).arc(100, 50, 0.022).arc(90, -52, 0.022).straight(60, 0.022).arc(110, -48, 0.026).arc(85, 58, 0.026).straight(50, 0.026).arc(100, -56, 0.026).arc(75, 62, 0.026).straight(40, 0.026);
    // wooden bridge 2 (flat)
    t.straight(40, 0).mark('bridge2-start').straight(170, 0).mark('bridge2-end').straight(60, 0);
    // river bends before the climb
    t.arc(260, -24, 0.03).arc(230, 30, 0.032).straight(80, 0.034).arc(300, -20, 0.036).straight(200, 0.04).arc(400, 18, 0.045).arc(340, -22, 0.045).straight(100, 0.045);
    // Cuesta Queulat: three hairpins
    t.mark('hairpins-start');
    t.straight(140, 0.07).arc(48, 180, 0.08).straight(150, 0.08).arc(48, -180, 0.08).straight(150, 0.08).arc(48, 180, 0.08).straight(130, 0.06);
    t.mark('hairpins-end');
    // viewpoint straight facing the hanging glacier
    t.arc(500, -14, 0.04).mark('viewpoint').straight(380, 0.055).arc(420, 12, 0.04).straight(100, 0.05);
    // flat finish at the pass
    t.straight(120, 0.02).straight(480, 0);
    return t.done();
}
