// Route for tools/gen-track.mjs patagonia. Default export: (Turtle) => turtle.done()
export default function route(Turtle) {
    const t = Turtle(115);
    t.straight(120, 0);
    // steppe straights with blind crests
    t.straight(260, 0.03).straight(300, -0.045).arc(1200, 9, -0.02).straight(240, 0.03).straight(300, -0.055).arc(1100, -7.3, -0.02).straight(200, 0.02).straight(300, -0.06).straight(250, -0.05);
    t.arc(1000, 8.4, -0.05).straight(360, -0.05);
    // glacier lake bridge on flat ground
    t.straight(60, 0).mark('bridge-run-start').straight(260, 0).mark('bridge-run-end').straight(60, 0);
    // lenga forest esses
    t.arc(130, 55, 0.02).arc(110, -75, 0.02).straight(60, 0.02).arc(120, 70, 0.025).arc(100, -80, 0.025).straight(50, 0.02).arc(140, 60, 0.02).arc(120, -65, 0.02).straight(80, 0.02).arc(110, 70, 0.025).arc(130, -60, 0.02).straight(120, 0.03);
    // moraine climb with two hairpins
    t.arc(500, -14, 0.06).straight(200, 0.06).arc(400, 14, 0.06).straight(100, 0.07).mark('hairpins-start');
    t.arc(46, 180, 0.08).straight(190, 0.08).arc(46, -180, 0.08).straight(240, 0.07).arc(600, 18, 0.06).straight(240, 0.07);
    t.arc(450, -16, 0.06).straight(200, 0.05).arc(500, 14, 0.04).straight(120, 0.03);
    // run toward the granite towers
    t.straight(560, 0.0);
    return t.done();
}
