"use strict";

class DisabledStaticServer {
	constructor() {
		throw new Error("node-static is disabled in mythicmons-team-lab. This project supports local CLI simulations only; do not run the Pokemon Showdown web server from this install.");
	}
}

exports.Server = DisabledStaticServer;
