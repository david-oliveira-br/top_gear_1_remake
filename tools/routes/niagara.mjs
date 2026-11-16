// Route for tools/gen-track.mjs niagara. Default export: (Turtle) => turtle.done()
export default function route(Turtle) {
    const t = Turtle(180);
    // Dufferin Islands: gentle esses among the trees
    t.straight(120, -0.002).arc(150, 40, -0.002).arc(140, -50, -0.002).arc(160, 30, -0.002).straight(80, -0.002);
    // flat deck bridge over the channel
    t.mark('bridge-start').straight(260, 0).mark('bridge-end').straight(80, -0.002);
    // Table Rock: fast sweeper along the Horseshoe Falls rim
    t.arc(420, 62, -0.004).straight(120, -0.004).arc(520, -40, -0.004).straight(100, -0.004);
    // Clifton Hill: three ~90 degree corners
    t.arc(65, 90, -0.006).straight(110, -0.006).arc(68, -90, -0.006).straight(90, -0.006).arc(62, 90, -0.006).straight(120, -0.006);
    // Rainbow Bridge overhead
    t.mark('overpass-start').straight(220, -0.004).mark('overpass-end').straight(40, -0.004);
    // gorge rim sweepers
    t.arc(300, -42, -0.011).arc(260, 55, -0.011).straight(120, -0.011).arc(380, -40, -0.011).arc(320, 34, -0.011).straight(140, -0.011).arc(280, 38, -0.011).arc(240, -48, -0.011).straight(160, -0.011).arc(420, 30, -0.011).straight(60, -0.011);
    // escarpment descent: two hairpins
    t.mark('hairpins-start').straight(70, -0.03).straight(70, -0.06).arc(52, 180, -0.072).straight(150, -0.072).arc(52, -180, -0.072).straight(100, -0.06).arc(260, 28, -0.035).straight(120, -0.015);
    t.mark('hairpins-end');
    // flat run to the Whirlpool Aero Car
    t.arc(500, -20, 0).straight(430, 0);
    return t.done();
}
