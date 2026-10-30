import * as THREE from 'three';
import { initTextures } from './textures.js';
import { initModels, MAT, GEO } from './models.js';
import { Stage } from './stage.js';
import { Player } from './player.js';
import { Barrel, Hammer } from './entities.js';
import { BodyMotion } from './motion.js';
import { PhoneHead, StereoView } from './cardboard.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { HUD } from './hud.js';

class Game {
    constructor() {
        this.score = 0;
        this.bonus = 5000;
        this.lives = 3;
        this.state = 'title'; // 'title', 'play', 'dead', 'win'

        this.initThree();
        initTextures();
        initModels();

        this.stage = new Stage(this);
        this.world.add(this.stage.meshGroup);

        this.player = new Player(this);
        this.motion = new BodyMotion();
        this.phoneHead = new PhoneHead();
        this.stereoView = new StereoView(this.renderer);
        this.input = new Input(this);
        this.sound = new Sound();
        this.hud = new HUD();

        this.barrels = [];
        this.items = [];
        this.barrelTimer = 0;
        this.headPitch = 0;

        this.setupEvents();
        this.spawnHammer();
        this.animate(0);
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0512);
        this.scene.fog = new THREE.FogExp2(0x0a0512, 0.015);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
        this.world = new THREE.Group();
        this.scene.add(this.world);

        const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambLight);

        const dirLight = new THREE.DirectionalLight(0xffdfb0, 1.2);
        dirLight.position.set(10, 30, 20);
        this.scene.add(dirLight);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        document.body.appendChild(this.renderer.domElement);
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        document.getElementById('enterVR')?.addEventListener('click', async () => {
            this.sound.unlock();
            await this.motion.enable();
            await this.phoneHead.enable();
            this.stereoView.active = true;
            this.startGame();
        });

        document.getElementById('play')?.addEventListener('click', () => {
            this.sound.unlock();
            this.stereoView.active = false;
            this.startGame();
        });
    }

    spawnHammer() {
        this.items.push(new Hammer(this, 12, 6.6, -6));
    }

    startGame() {
        this.score = 0;
        this.bonus = 5000;
        this.lives = 3;
        this.hud.setScore(this.score);
        this.hud.setBonus(this.bonus);
        this.hud.setLives(this.lives);
        this.hud.showTitle(false);
        this.restartStage();
    }

    restartStage() {
        this.barrels.forEach(b => this.world.remove(b.mesh));
        this.barrels = [];
        this.player.reset(0, 0.5, 0);
        this.state = 'play';
        this.sound.music('theme');
    }

    killPlayer() {
        if (this.state !== 'play') return;
        this.lives--;
        this.hud.setLives(this.lives);
        if (this.lives <= 0) {
            this.hud.showMessage('GAME OVER', 'Tap screen or press Space to restart');
            this.state = 'title';
            setTimeout(() => this.hud.showTitle(true), 2500);
        } else {
            this.hud.showMessage('MISSED!', 'Get ready...');
            this.state = 'dead';
            setTimeout(() => {
                this.hud.showMessage('');
                this.restartStage();
            }, 1800);
        }
    }

    winStage() {
        if (this.state !== 'play') return;
        this.state = 'win';
        this.score += this.bonus;
        this.hud.setScore(this.score);
        this.sound.play('win');
        this.hud.showMessage('VICTORY!', 'You saved Pauline!');
        setTimeout(() => {
            this.hud.showMessage('');
            this.restartStage();
        }, 3000);
    }

    togglePause() {}
    toggleMute() { this.sound.toggleMute(); }
    recenterVR() {}

    animate(now) {
        requestAnimationFrame(t => this.animate(t));
        const dt = Math.min(Math.max((now - (this.lastTime || now)) / 1000, 0.001), 0.1);
        this.lastTime = now;

        if (this.phoneHead.listening) {
            this.phoneHead.update();
            this.camera.quaternion.copy(this.phoneHead.quat);
            // Calculate head pitch angle for ladder climbing
            const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            this.headPitch = euler.x;
        } else {
            this.camera.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ');
            this.headPitch = this.input.pitch;
        }

        this.motion.update(now / 1000, dt);
        this.input.update(dt);

        if (this.state === 'play') {
            this.bonus = Math.max(0, this.bonus - dt * 20);
            this.hud.setBonus(Math.floor(this.bonus));

            this.player.step(dt, this.input);

            // Spawn barrels periodically from DK at top
            this.barrelTimer += dt;
            if (this.barrelTimer > 3.2) {
                this.barrelTimer = 0;
                this.barrels.push(new Barrel(this, 2, 18, -12, -4.5, 0));
            }

            this.barrels.forEach(b => b.update(dt));
            this.items.forEach(i => i.update(dt));
        }

        this.sound.update();

        // Update camera position to player's eye level and ensure matrixWorld is updated
        this.camera.position.set(this.player.x, this.player.y + this.player.eye, this.player.z);
        this.camera.updateMatrixWorld();

        if (this.stereoView.active) {
            this.stereoView.render(this.scene, this.camera);
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => { new Game(); });
