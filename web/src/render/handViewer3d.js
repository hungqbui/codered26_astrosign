// three.js view of 3-D hand landmarks for the practice coach: the target pose as a ghost hand,
// the player's tracked hand overlaid on it, each finger coloured by how close it is.
import * as THREE from 'three';
import { HAND_CONNECTIONS } from '../game/letters.js';
import { FINGERS } from '../recognition/poseCoach.js';

const STATUS_COLORS = { ok: 0x3dff7a, close: 0xffc13d, off: 0xff4a4a };
const fingerOf = (j) => FINGERS.findIndex((f) => f.includes(j)); // -1 = wrist
const boneFinger = ([a, b]) => FINGERS.findIndex((f) => f.includes(a) && f.includes(b)); // -1 = palm
const UP = new THREE.Vector3(0, 1, 0);

export class HandRig {
  constructor(parent, { color, opacity, joint, bone, emissive }) {
    this.group = new THREE.Group();
    parent.add(this.group);
    const mat = () => new THREE.MeshStandardMaterial({
      color, emissive: emissive ?? color, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.1,
      transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    this.palmMat = mat();
    this.fingerMats = FINGERS.map(() => mat());
    const jointGeo = new THREE.SphereGeometry(joint, 16, 12);
    const boneGeo = new THREE.CylinderGeometry(bone, bone, 1, 10);
    this.joints = Array.from({ length: 21 }, (_, j) => {
      const f = fingerOf(j);
      const m = new THREE.Mesh(jointGeo, f < 0 ? this.palmMat : this.fingerMats[f]);
      this.group.add(m);
      return m;
    });
    this.bones = HAND_CONNECTIONS.map((c) => {
      const f = boneFinger(c);
      const m = new THREE.Mesh(boneGeo, f < 0 ? this.palmMat : this.fingerMats[f]);
      this.group.add(m);
      return { c, m };
    });
    // Translucent palm: a fan from the wrist through the finger bases.
    this.palmGeo = new THREE.BufferGeometry();
    this.palmGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3));
    this.palmGeo.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
    this.palm = new THREE.Mesh(this.palmGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opacity * 0.35, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.group.add(this.palm);
    this.baseColor = new THREE.Color(color);
  }

  set visible(v) { this.group.visible = v; }

  /** @param {THREE.Vector3[]} P 21 points; @param {string[]|null} status per finger */
  update(P, status = null) {
    P.forEach((p, j) => this.joints[j].position.copy(p));
    const dir = new THREE.Vector3();
    for (const { c: [a, b], m } of this.bones) {
      dir.subVectors(P[b], P[a]);
      const len = dir.length();
      m.position.addVectors(P[a], P[b]).multiplyScalar(0.5);
      m.scale.set(1, Math.max(len, 1e-4), 1);
      m.quaternion.setFromUnitVectors(UP, dir.normalize());
    }
    const pos = this.palmGeo.attributes.position;
    [0, 1, 5, 9, 13, 17].forEach((j, k) => pos.setXYZ(k, P[j].x, P[j].y, P[j].z));
    pos.needsUpdate = true;
    this.palmGeo.computeBoundingSphere();
    this.fingerMats.forEach((m, i) => {
      const col = status ? new THREE.Color(STATUS_COLORS[status[i]]) : this.baseColor;
      m.color.copy(col);
      m.emissive.copy(col);
    });
  }
}

export class HandViewer3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{color:string, hand:'left'|'right'}} opts hand decides the mirrored display (as in a mirror)
   */
  constructor(canvas, { color, hand }) {
    this.canvas = canvas;
    this.flip = hand === 'right' ? -1 : 1; // same convention as drawTemplate()
    // Throws if WebGL is unavailable; the caller then shows the 2-D fallback.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 3, 6);
    this.scene.add(key);
    const rim = new THREE.PointLight(new THREE.Color(color), 18, 20);
    rim.position.set(-3, 2, -2);
    this.scene.add(rim);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    const grid = new THREE.PolarGridHelper(2.2, 8, 4, 48, 0x6a4bd6, 0x2c1d63);
    grid.position.y = -1.9;
    this.scene.add(grid);
    this.grid = grid;

    this.target = new HandRig(this.pivot, { color: 0xffffff, emissive: 0x8888ff, opacity: 0.32, joint: 0.075, bone: 0.05 });
    this.live = new HandRig(this.pivot, { color: new THREE.Color(color).getHex(), opacity: 1, joint: 0.085, bone: 0.055 });
    this.live.visible = false;
    this.center = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.installDrag();
    this.resize();
  }

  toVec(p) {
    // MediaPipe: x right, y down, z negative toward the camera -> three.js: y up, z toward viewer.
    return new THREE.Vector3(p[0] * this.flip, -p[1], -(p[2] ?? 0)).sub(this.center);
  }

  /** Switch between showing a left or right hand (mirrored display, like drawTemplate). */
  setHand(hand) {
    const flip = hand === 'right' ? -1 : 1;
    if (flip === this.flip) return;
    this.flip = flip;
    if (this.pose) this.setPose(this.pose);
  }

  setPose(pose) {
    this.pose = pose;
    const raw = pose.points.map((p) => new THREE.Vector3(p[0] * this.flip, -p[1], -(p[2] ?? 0)));
    const box = new THREE.Box3().setFromPoints(raw);
    box.getCenter(this.center);
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    this.camera.position.set(0, 0.2, (radius * 1.15) / Math.sin(THREE.MathUtils.degToRad(16)));
    this.camera.lookAt(0, 0, 0);
    this.grid.position.y = -radius * 1.05;
    this.target.update(pose.points.map((p) => this.toVec(p)));
  }

  /** @param {number[][]|null} normalised player's normalised points, @param {string[]} status */
  setLive(normalised, status) {
    this.live.visible = !!normalised;
    if (normalised) this.live.update(normalised.map((p) => this.toVec(p)), status);
  }

  installDrag() {
    let last = null;
    this.canvas.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      this.yaw += (e.clientX - last[0]) * 0.01;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - last[1]) * 0.01, -1.2, 1.2);
      last = [e.clientX, e.clientY];
      this.dragged = performance.now();
    });
    const end = () => { last = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (this._w === w && this._h === h) return;
    this._w = w;
    this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** False once the shared WebGL context is gone for good (caller falls back to 2-D). */
  get ok() {
    return !this.renderer.getContext().isContextLost() || this.lostAt === undefined || performance.now() - this.lostAt < 3000;
  }

  render(t, reduced = false) {
    this.resize();
    // Gentle sway reveals depth; paused while (and shortly after) the player drags.
    const idle = !this.dragged || performance.now() - this.dragged > 2500;
    const sway = reduced || !idle ? 0 : Math.sin(t * 0.7) * 0.5;
    this.pivot.rotation.set(this.pitch, this.yaw + sway, 0);
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) {
      this.lostAt ??= performance.now();
      return;
    }
    this.lostAt = undefined;
    this.resize();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
