const EPS = 1e-4;

export class CollisionWorld {
    constructor() {
        this.cols = new Map();
        this.stamp = 1;
        this.out = [];
    }

    add(s) {
        s.stamp = 0;
        s.c0 = Math.floor(s.minX);
        s.c1 = Math.floor(s.maxX - 1e-6);
        for (let c = s.c0; c <= s.c1; c++) {
            let col = this.cols.get(c);
            if (!col) this.cols.set(c, col = []);
            col.push(s);
        }
        return s;
    }

    remove(s) {
        for (let c = s.c0; c <= s.c1; c++) {
            const col = this.cols.get(c);
            if (!col) continue;
            const i = col.indexOf(s);
            if (i >= 0) col.splice(i, 1);
        }
    }

    query(minX, maxX) {
        const out = this.out;
        out.length = 0;
        const st = ++this.stamp;
        for (let c = Math.floor(minX); c <= Math.floor(maxX); c++) {
            const col = this.cols.get(c);
            if (!col) continue;
            for (const s of col) {
                if (s.stamp !== st) { s.stamp = st; out.push(s); }
            }
        }
        return out;
    }

    groundBelow(x, z, y, r = 0.1) {
        let best = -Infinity;
        for (const s of this.query(x - r, x + r)) {
            if (s.hidden || s.off || s.noShadow) continue;
            if (x + r <= s.minX || x - r >= s.maxX || z + r <= s.minZ || z - r >= s.maxZ) continue;
            if (s.maxY <= y + 0.01 && s.maxY > best) best = s.maxY;
        }
        return best;
    }
}

export function overlaps(e, s) {
    return e.x - e.hx < s.maxX && e.x + e.hx > s.minX &&
        e.y < s.maxY && e.y + e.h > s.minY &&
        e.z - e.hz < s.maxZ && e.z + e.hz > s.minZ;
}

export function boxesTouch(a, b, pad = 0) {
    return Math.abs(a.x - b.x) < a.hx + b.hx + pad &&
        Math.abs(a.z - b.z) < a.hz + b.hz + pad &&
        a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;
}

function blocks(e, s) {
    if (s.off) return false;
    if (s.hidden) return false;
    return true;
}

export function makeResult() {
    return { hitX: false, hitZ: false, ground: false, ceil: false, groundSolid: null, wallSolid: null };
}

export function moveEntity(world, e, dx, dy, dz, res) {
    res.hitX = res.hitZ = res.ground = res.ceil = false;
    res.groundSolid = null;
    res.wallSolid = null;

    const TOL = 0.01;

    if (dx !== 0) {
        const prevR = e.x + e.hx, prevL = e.x - e.hx;
        e.x += dx;
        let best = null;
        for (const s of world.query(e.x - e.hx, e.x + e.hx)) {
            if (!blocks(e, s) || !overlaps(e, s)) continue;
            if (dx > 0 ? s.minX < prevR - TOL : s.maxX > prevL + TOL) continue;
            const nx = dx > 0 ? s.minX - e.hx - EPS : s.maxX + e.hx + EPS;
            if (best === null || (dx > 0 ? nx < best : nx > best)) best = nx;
            res.wallSolid = s;
        }
        if (best !== null) { e.x = best; res.hitX = true; }
    }

    if (dz !== 0) {
        const prevF = e.z + e.hz, prevB = e.z - e.hz;
        e.z += dz;
        let best = null;
        for (const s of world.query(e.x - e.hx, e.x + e.hx)) {
            if (!blocks(e, s) || !overlaps(e, s)) continue;
            if (dz > 0 ? s.minZ < prevF - TOL : s.maxZ > prevB + TOL) continue;
            const nz = dz > 0 ? s.minZ - e.hz - EPS : s.maxZ + e.hz + EPS;
            if (best === null || (dz > 0 ? nz < best : nz > best)) best = nz;
            res.wallSolid = s;
        }
        if (best !== null) { e.z = best; res.hitZ = true; }
    }

    if (dy !== 0) {
        const prevTop = e.y + e.h, prevBottom = e.y;
        e.y += dy;
        let best = null;
        for (const s of world.query(e.x - e.hx, e.x + e.hx)) {
            if (!blocks(e, s) || !overlaps(e, s)) continue;
            if (dy < 0 ? s.maxY > prevBottom + TOL : s.minY < prevTop - TOL) continue;
            if (dy < 0) {
                if (best === null || s.maxY > best) { best = s.maxY; res.groundSolid = s; }
            } else {
                const ny = s.minY - e.h - EPS;
                if (best === null || ny < best) best = ny;
            }
        }
        if (best !== null) {
            e.y = best;
            if (dy < 0) res.ground = true;
            else res.ceil = true;
        }
    }
    return res;
}
