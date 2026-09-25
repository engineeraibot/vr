// Axis-aligned box collision against the level's solids.
// Entities are boxes described by their bottom-centre (x, y, z), half widths (hx, hz) and height (h).

const EPS = 1e-4;

export class CollisionWorld {
    constructor() {
        this.cols = new Map(); // integer x column -> solids overlapping it
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

    // Returns a shared array: consume it before calling query() again.
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

    // Highest solid top under the point (x, z) that is at or below y.
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

function blocks(e, s, dy, prevTop) {
    if (s.off) return false;
    // Hidden blocks only exist for the player jumping into them from below.
    if (s.hidden) return !!e.isPlayer && dy > 0 && prevTop <= s.minY + 0.05;
    if (s.playerOnly && !e.isPlayer) return false;
    return true;
}

export function makeResult() {
    return { hitX: false, hitZ: false, ground: false, ceil: false, ceilHits: [], groundSolid: null, wallSolid: null };
}

export function moveEntity(world, e, dx, dy, dz, res) {
    res.hitX = res.hitZ = res.ground = res.ceil = false;
    res.ceilHits.length = 0;
    res.groundSolid = null;
    res.wallSolid = null;

    // Only solids we were not already inside count, so an entity that ends up
    // overlapping something (e.g. growing under a block) is never teleported.
    const TOL = 0.01;

    if (dx !== 0) {
        const prevR = e.x + e.hx, prevL = e.x - e.hx;
        e.x += dx;
        let best = null;
        for (const s of world.query(e.x - e.hx, e.x + e.hx)) {
            if (!blocks(e, s, 0, 0) || !overlaps(e, s)) continue;
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
            if (!blocks(e, s, 0, 0) || !overlaps(e, s)) continue;
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
            if (!blocks(e, s, dy, prevTop) || !overlaps(e, s)) continue;
            if (dy < 0 ? s.maxY > prevBottom + TOL : s.minY < prevTop - TOL) continue;
            if (dy < 0) {
                if (best === null || s.maxY > best) { best = s.maxY; res.groundSolid = s; }
            } else {
                const ny = s.minY - e.h - EPS;
                if (best === null || ny < best) best = ny;
                res.ceilHits.push(s);
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
