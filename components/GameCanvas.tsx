"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import { formatSeconds } from "@/lib/format";
import { publishBest, readBest } from "@/lib/storage";
import type { RunResult } from "@/lib/types";

export type GameHandle = {
  start: () => void;
};

type Props = {
  onHud: (seconds: number, near: number) => void;
  onPhase: (phase: "playing" | "over") => void;
  onEnd: (result: RunResult) => void;
  allowHotkeysRef: RefObject<boolean>;
};

type Hazard = { x: number; y: number; vx: number; vy: number; r: number; phase: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string; r: number };
type Star = { x: number; y: number; a: number; r: number };

type Sim = {
  phase: "intro" | "playing" | "over";
  W: number;
  H: number;
  last: number;
  elapsed: number;
  near: number;
  best: number;
  player: { x: number; y: number; tx: number; ty: number; r: number };
  hazards: Hazard[];
  particles: Particle[];
  stars: Star[];
  spawn: number;
  shake: number;
  frame: number;
  nearCooldown: number;
  pointerDown: boolean;
  desktop: boolean;
};

export const GameCanvas = forwardRef<GameHandle, Props>(function GameCanvas(
  { onHud, onPhase, onEnd, allowHotkeysRef },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<() => void>(() => {});
  const onHudRef = useRef(onHud);
  const onPhaseRef = useRef(onPhase);
  const onEndRef = useRef(onEnd);
  onHudRef.current = onHud;
  onPhaseRef.current = onPhase;
  onEndRef.current = onEnd;

  useImperativeHandle(ref, () => ({ start: () => startRef.current() }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const arena = canvas?.parentElement;
    if (!canvas || !ctx || !arena) return;

    const saved = readBest();
    const sim: Sim = {
      phase: "intro",
      W: 0,
      H: 0,
      last: performance.now(),
      elapsed: 0,
      near: 0,
      best: saved.seconds,
      player: { x: 0, y: 0, tx: 0, ty: 0, r: 8 },
      hazards: [],
      particles: [],
      stars: [],
      spawn: 0.45,
      shake: 0,
      frame: 0,
      nearCooldown: 0,
      pointerDown: false,
      desktop: false,
    };

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    const resize = () => {
      const rect = arena.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width < 2 || height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sim.W = width;
      sim.H = height;
      sim.stars = Array.from({ length: Math.max(12, Math.floor((width * height) / 6500)) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        a: Math.random() * 0.35 + 0.08,
        r: Math.random() * 1.3 + 0.3,
      }));
      if (sim.phase !== "playing") {
        sim.player.x = width / 2;
        sim.player.y = height * 0.7;
        sim.player.tx = sim.player.x;
        sim.player.ty = sim.player.y;
      } else {
        sim.player.tx = clamp(sim.player.tx, 15, width - 15);
        sim.player.ty = clamp(sim.player.ty, 15, height - 15);
      }
    };

    const burst = (x: number, y: number, color: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.7 + 0.5;
        sim.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color,
          r: Math.random() * 2 + 1,
        });
      }
    };

    const addHazard = () => {
      const hard = sim.desktop;
      const edge = Math.floor(Math.random() * 4);
      const pad = 18;
      const sideAim = hard ? 0.02 : 0.012;
      let x = 0;
      let y = 0;
      let vx = 0;
      let vy = 0;
      if (edge === 0) {
        x = Math.random() * sim.W;
        y = -pad;
        vx = (sim.player.x - x) * (hard ? 0.15 + Math.random() * 0.06 : 0.12 + Math.random() * 0.06);
        vy = hard ? 1.2 + Math.random() * 0.85 : 1 + Math.random() * 0.7;
      } else if (edge === 1) {
        x = sim.W + pad;
        y = Math.random() * sim.H;
        vx = -(hard ? 1.25 + Math.random() : 1.1 + Math.random());
        vy = (sim.player.y - y) * sideAim;
      } else if (edge === 2) {
        x = Math.random() * sim.W;
        y = sim.H + pad;
        vx = (sim.player.x - x) * sideAim;
        vy = -(hard ? 1.25 + Math.random() : 1.1 + Math.random());
      } else {
        x = -pad;
        y = Math.random() * sim.H;
        vx = hard ? 1.25 + Math.random() : 1.1 + Math.random();
        vy = (sim.player.y - y) * sideAim;
      }
      const speed = hard ? 1.15 + Math.min(sim.elapsed / 22, 3) : 1 + Math.min(sim.elapsed / 28, 2.5);
      sim.hazards.push({
        x,
        y,
        vx: vx * speed,
        vy: vy * speed,
        r: hard ? 6 + Math.random() * 6 : 5 + Math.random() * 5,
        phase: Math.random() * 6.28,
      });
    };

    const hazardCount = () => {
      if (!sim.desktop) return 1;
      let count = 1;
      if (sim.elapsed > 8 && Math.random() < 0.45) count += 1;
      if (sim.elapsed > 18 && sim.W >= 1000) count += 1;
      return count;
    };

    const reset = () => {
      sim.elapsed = 0;
      sim.near = 0;
      sim.spawn = sim.desktop ? 0.28 : 0.45;
      sim.hazards = [];
      sim.particles = [];
      sim.shake = 0;
      sim.nearCooldown = 0;
      sim.player = {
        x: sim.W / 2,
        y: sim.H * 0.72,
        tx: sim.W / 2,
        ty: sim.H * 0.72,
        r: 8,
      };
      onHudRef.current(0, 0);
    };

    const finish = () => {
      if (sim.phase !== "playing") return;
      const shown = Number(formatSeconds(sim.elapsed));
      const previous = Number(formatSeconds(sim.best));
      const isBest = shown > previous;
      if (isBest) {
        sim.best = shown;
        publishBest(shown, sim.near);
      }
      sim.phase = "over";
      sim.shake = 8;
      burst(sim.player.x, sim.player.y, "#67f4e2", 30);
      onHudRef.current(sim.elapsed, sim.near);
      onPhaseRef.current("over");
      onEndRef.current({
        seconds: sim.elapsed,
        nearMisses: sim.near,
        best: isBest ? shown : sim.best,
        isBest,
      });
    };

    const start = () => {
      if (sim.W < 2 || sim.phase === "playing") return;
      reset();
      sim.phase = "playing";
      sim.last = performance.now();
      onPhaseRef.current("playing");
    };
    startRef.current = start;

    const touchLead = (pointerY: number) => {
      const maxLead = Math.min(72, Math.max(48, sim.H * 0.09));
      const taperStart = sim.H - maxLead * 1.35;
      if (pointerY <= taperStart) return maxLead;
      const t = (pointerY - taperStart) / Math.max(1, sim.H - taperStart);
      return maxLead * (1 - Math.min(1, Math.max(0, t)));
    };

    const moveTarget = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const lead = event.pointerType === "touch" ? touchLead(y) : 0;
      sim.player.tx = clamp(x, 15, sim.W - 15);
      sim.player.ty = clamp(y - lead, 15, sim.H - 15);
    };

    const onPointerDown = (event: PointerEvent) => {
      sim.pointerDown = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* The pointer can end before capture lands. */
      }
      moveTarget(event);
      if (sim.phase === "intro") start();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (sim.pointerDown) moveTarget(event);
    };
    const onPointerUp = () => {
      sim.pointerDown = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, a, input, textarea")) return;
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
        const step = 28;
        if (key === "arrowup" || key === "w") sim.player.ty -= step;
        if (key === "arrowdown" || key === "s") sim.player.ty += step;
        if (key === "arrowleft" || key === "a") sim.player.tx -= step;
        if (key === "arrowright" || key === "d") sim.player.tx += step;
        sim.player.tx = clamp(sim.player.tx, 12, sim.W - 12);
        sim.player.ty = clamp(sim.player.ty, 12, sim.H - 12);
      }
      if ((key === " " || key === "enter") && sim.phase !== "playing" && allowHotkeysRef.current) {
        event.preventDefault();
        start();
      }
    };

    const render = (dt: number) => {
      sim.frame += 1;
      if (sim.shake > 0) sim.shake = Math.max(0, sim.shake - dt * 20);
      ctx.clearRect(0, 0, sim.W, sim.H);
      ctx.save();
      if (sim.shake) {
        ctx.translate((Math.random() - 0.5) * sim.shake, (Math.random() - 0.5) * sim.shake);
      }
      for (const star of sim.stars) {
        ctx.globalAlpha = star.a * (0.8 + 0.2 * Math.sin(sim.frame * 0.02 + star.x));
        ctx.fillStyle = "#a6c6ff";
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const hazard of sim.hazards) {
        hazard.phase += dt * 3;
        const glow = ctx.createRadialGradient(hazard.x, hazard.y, 1, hazard.x, hazard.y, hazard.r * 3.8);
        glow.addColorStop(0, "#fff0f3");
        glow.addColorStop(0.22, "#ff738c");
        glow.addColorStop(0.65, "#ff426b55");
        glow.addColorStop(1, "#ff426b00");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.r * 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ff8297";
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.r + Math.sin(hazard.phase) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffc0ca";
        ctx.beginPath();
        ctx.arc(hazard.x, hazard.y, hazard.r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = sim.particles.length - 1; i >= 0; i -= 1) {
        const particle = sim.particles[i];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.life -= dt * 1.5;
        if (particle.life <= 0) {
          sim.particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = particle.life;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.r * particle.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const player = sim.player;
      const glow = ctx.createRadialGradient(player.x - 3, player.y - 4, 1, player.x, player.y, 25);
      glow.addColorStop(0, "#ffffff");
      glow.addColorStop(0.2, "#b9fff8");
      glow.addColorStop(0.48, "#4cf0df");
      glow.addColorStop(1, "#4cf0df00");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#eaffff";
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#9ffff6";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    let hudAt = 0;
    let raf = 0;
    let alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min((now - sim.last) / 1000, 0.04);
      sim.last = now;
      if (sim.phase === "playing") {
        sim.elapsed += dt;
        sim.nearCooldown = Math.max(0, sim.nearCooldown - dt);
        sim.player.x += (sim.player.tx - sim.player.x) * Math.min(1, dt * 10);
        sim.player.y += (sim.player.ty - sim.player.y) * Math.min(1, dt * 10);
        sim.spawn -= dt;
        if (sim.spawn <= 0) {
          const count = hazardCount();
          for (let n = 0; n < count; n += 1) addHazard();
          sim.spawn = sim.desktop
            ? Math.max(0.12, 0.55 - sim.elapsed * 0.009) + Math.random() * 0.16
            : Math.max(0.19, 0.78 - sim.elapsed * 0.008) + Math.random() * 0.24;
        }
        for (let i = sim.hazards.length - 1; i >= 0; i -= 1) {
          const hazard = sim.hazards[i];
          if (sim.desktop && sim.elapsed > 12) {
            const dx = sim.player.x - hazard.x;
            const dy = sim.player.y - hazard.y;
            const dist = Math.hypot(dx, dy);
            const reach = 340;
            if (dist > 1 && dist < reach) {
              const ramp = Math.min(1, (sim.elapsed - 12) / 26);
              const falloff = (1 - dist / reach) ** 2;
              const steer = (0.006 + 0.018 * ramp) * falloff;
              const speedNow = Math.hypot(hazard.vx, hazard.vy) || 0.001;
              hazard.vx += ((dx / dist) * speedNow - hazard.vx) * steer;
              hazard.vy += ((dy / dist) * speedNow - hazard.vy) * steer;
            }
          }
          hazard.x += hazard.vx;
          hazard.y += hazard.vy;
          if (hazard.x < -45 || hazard.x > sim.W + 45 || hazard.y < -45 || hazard.y > sim.H + 45) {
            sim.hazards.splice(i, 1);
            continue;
          }
          const distance = Math.hypot(hazard.x - sim.player.x, hazard.y - sim.player.y);
          const hit = hazard.r + sim.player.r + 1;
          if (distance < hit) {
            burst(sim.player.x, sim.player.y, "#ff617e", 28);
            finish();
            break;
          }
          if (distance < hit + 17 && sim.nearCooldown <= 0) {
            sim.near += 1;
            sim.nearCooldown = 0.38;
            burst(sim.player.x, sim.player.y, "#67f4e2", 5);
            onHudRef.current(sim.elapsed, sim.near);
            hudAt = now;
          }
        }
        if (now - hudAt > 100) {
          hudAt = now;
          onHudRef.current(sim.elapsed, sim.near);
        }
      }
      render(sim.phase === "playing" ? dt : 0.016);
      raf = requestAnimationFrame(loop);
    };

    const desktopMedia = window.matchMedia("(pointer: fine) and (hover: hover)");
    const syncDesktop = () => {
      sim.desktop = desktopMedia.matches;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(arena);
    syncDesktop();
    resize();
    desktopMedia.addEventListener("change", syncDesktop);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      desktopMedia.removeEventListener("change", syncDesktop);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [allowHotkeysRef]);

  return <canvas ref={canvasRef} className="game-canvas" aria-hidden="true" />;
});
