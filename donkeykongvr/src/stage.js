import * as THREE from 'three';
import { CollisionWorld } from './physics.js';
import { GEO, MAT } from './models.js';

export class Stage {
    constructor(game) {
        this.game = game;
        this.cw = new CollisionWorld();
        this.meshGroup = new THREE.Group();
        this.ladders = [];
        this.cannons = [];
        this.items = [];
        this.dkPosition = new THREE.Vector3(0, 18, -12);
        this.paulinePosition = new THREE.Vector3(0, 22, -14);
        this.build();
    }

    addGirder(x0, y0, z0, x1, y1, z1, w = 3) {
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const len = Math.hypot(dx, dy, dz);
        const mesh = new THREE.Mesh(GEO.block, MAT.girder);
        mesh.scale.set(w, 0.6, len);
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
        mesh.position.set(mx, my, mz);
        mesh.rotation.y = Math.atan2(dx, dz);
        mesh.rotation.x = Math.atan2(-dy, Math.hypot(dx, dz));
        this.meshGroup.add(mesh);

        // Segment collision box along slope
        const segments = Math.max(1, Math.ceil(len));
        for (let i = 0; i < segments; i++) {
            const t0 = i / segments, t1 = (i + 1) / segments;
            const sx0 = x0 + dx * t0, sy0 = y0 + dy * t0, sz0 = z0 + dz * t0;
            const sx1 = x0 + dx * t1, sy1 = y0 + dy * t1, sz1 = z0 + dz * t1;
            const hx = w / 2, h = 0.6;
            const minX = Math.min(sx0, sx1) - hx, maxX = Math.max(sx0, sx1) + hx;
            const minY = Math.min(sy0, sy1) - h / 2, maxY = Math.max(sy0, sy1) + h / 2;
            const minZ = Math.min(sz0, sz1) - hx, maxZ = Math.max(sz0, sz1) + hx;
            this.cw.add({ minX, maxX, minY, maxY, minZ, maxZ });
        }
    }

    addLadder(x, y0, y1, z, isVine = false) {
        const h = Math.abs(y1 - y0);
        const mesh = new THREE.Mesh(GEO.block, MAT.ladder);
        mesh.scale.set(1.2, h, 0.1);
        mesh.position.set(x, (y0 + y1) / 2, z);
        this.meshGroup.add(mesh);

        this.ladders.push({
            x, z, minY: Math.min(y0, y1), maxY: Math.max(y0, y1), isVine
        });
    }

    addCannon(x, y, z, targetX, targetY, targetZ) {
        const mesh = new THREE.Mesh(GEO.cannon, MAT.vcol);
        mesh.position.set(x, y, z);
        mesh.rotation.z = Math.PI / 4;
        this.meshGroup.add(mesh);

        this.cannons.push({
            x, y, z, radius: 1.5,
            target: new THREE.Vector3(targetX, targetY, targetZ),
            mesh
        });
    }

    build() {
        // Base ground level
        this.addGirder(-15, 0, 0, 15, 0, 0, 6);

        // Tier 1: Slanted girder going up left-to-right
        this.addGirder(-14, 2, -3, 14, 4, -3, 4);

        // Tier 2: Slanted girder going right-to-left
        this.addGirder(14, 6, -6, -14, 8, -6, 4);

        // Tier 3: Slanted girder going left-to-right
        this.addGirder(-14, 10, -9, 14, 12, -9, 4);

        // Tier 4: Slanted girder going right-to-left
        this.addGirder(14, 14, -12, -14, 16, -12, 4);

        // Top perch for DK and Pauline
        this.addGirder(-6, 18, -14, 6, 18, -14, 5); // DK platform
        this.addGirder(-2, 22, -15, 2, 22, -15, 4); // Pauline peak

        // Connecting Ladders
        this.addLadder(-10, 0, 2.3, 0);
        this.addLadder(10, 3.4, 6.5, -4.5);
        this.addLadder(-10, 7.4, 10.5, -7.5);
        this.addLadder(10, 11.4, 14.5, -10.5);
        this.addLadder(0, 16, 18, -13); // Final ladder to DK
        this.addLadder(0, 18, 22, -14.5, true); // Vine to Pauline

        // Floating Barrel Cannons across gap on tier 2 and tier 3
        this.addCannon(-16, 5, -5, -10, 8, -7);
        this.addCannon(16, 11, -10, 10, 15, -12);

        // Donkey Kong mesh
        this.dkMesh = new THREE.Mesh(GEO.dk, MAT.vcol);
        this.dkMesh.position.copy(this.dkPosition);
        this.meshGroup.add(this.dkMesh);

        // Pauline mesh
        this.paulineMesh = new THREE.Mesh(GEO.pauline, MAT.vcol);
        this.paulineMesh.position.copy(this.paulinePosition);
        this.meshGroup.add(this.paulineMesh);
    }
}
