/**
 * Optional aim assist for touch and controller (never mouse). Off by default; toggled in Options or the pause menu.
 * Touch: holding FIRE or KNIFE without dragging turns the player to the nearest zombie, unless the right
 * thumb has been working the aim stick (claw grip), in which case it locks on like a controller.
 * Controller: aim slows right down while it passes over a zombie, so it is easy to settle on one without
 * ever losing control; holding RT/LT with the right stick idle picks the nearest.
 */

const AIM_ASSIST_STORAGE_KEY = "project115.aimAssist"
const AIM_ASSIST_KNIFE_RANGE = 450 //world px: knife auto-turn only for zombies about to be in reach
const AIM_ASSIST_SLOW_ANGLE = 18 * Math.PI / 180 //stick aiming: aim this close to a zombie and it drags
const AIM_ASSIST_SLOW_RATE = 60 * Math.PI / 180 //radians per second the aim may turn while dragging
const AIM_ASSIST_KEEP_RANGE = 1.15 //touch: keep the current target unless another is this much closer

function loadAimAssistSetting() {
    try {
        return localStorage.getItem(AIM_ASSIST_STORAGE_KEY) === "on"
    } catch (e) {
        return false
    }
}

function setAimAssist(on) {
    GAME_ENGINE.options.aimAssist = on
    try {
        localStorage.setItem(AIM_ASSIST_STORAGE_KEY, on ? "on" : "off")
    } catch (e) {

    }
}

class AimAssist {
    constructor(engine) {
        this.engine = engine
        this.target = null
    }

    clear() {
        this.target = null
    }

    angleTo(zombie) {
        const player = this.engine.ent_Player
        return Math.atan2(zombie.posY - player.posY, zombie.posX - player.posX)
    }

    /** Nearest shootable zombie, preferring the current target so aim doesn't flick between two at similar range. */
    nearest(maxRange = Infinity) {
        const candidates = this.candidates(maxRange)
        if (candidates.length === 0) return this.target = null
        const current = candidates.find(c => c.zombie === this.target)
        const best = candidates[0]
        if (current != null && current.distance <= best.distance * AIM_ASSIST_KEEP_RANGE) return this.target
        return this.target = best.zombie
    }

    /** Shootable zombie the aim is currently sitting on, if any. */
    alongAim(aimAngle) {
        let best = null
        let bestDiff = AIM_ASSIST_SLOW_ANGLE
        for (const candidate of this.candidates()) {
            const diff = Math.abs(angleDifference(this.angleTo(candidate.zombie), aimAngle))
            if (diff < bestDiff) {
                bestDiff = diff
                best = candidate.zombie
            }
        }
        return this.target = best
    }

    /**
     * Aim turned toward where the stick points, but crawling while it sits on a zombie, the way aim assist
     * slows a thumbstick in a console shooter. Keep pushing and the aim still sweeps past.
     */
    slowedAim(current, desired, clockTick) {
        const diff = angleDifference(desired, current)
        if (this.alongAim(current) != null) { //already on a zombie: crawl
            const maxStep = AIM_ASSIST_SLOW_RATE * clockTick
            return current + Math.max(-maxStep, Math.min(maxStep, diff))
        }
        //a flick of the stick would jump clean over a zombie; stop at the near edge of its slow zone instead
        const direction = Math.sign(diff) || 1
        let entry = null
        for (const candidate of this.candidates()) {
            const toZombie = angleDifference(this.angleTo(candidate.zombie), current)
            if (Math.sign(toZombie) !== direction) continue //behind the direction of the swing
            const edge = toZombie - (direction * AIM_ASSIST_SLOW_ANGLE)
            if (Math.abs(edge) >= Math.abs(diff)) continue //the zombie is past where the stick points
            if (entry == null || Math.abs(edge) < Math.abs(entry)) entry = edge
        }
        if (entry == null) return desired
        //land just inside the zone, so the next frame crawls instead of sticking on the boundary
        return current + entry + (direction * 0.001)
    }

    /** Live zombies on screen with no wall between them and the player, nearest first. */
    candidates(maxRange = Infinity) {
        const player = this.engine.ent_Player
        const halfWidth = this.engine.ctx.canvas.width / 2
        const halfHeight = this.engine.ctx.canvas.height / 2
        const walls = this.engine.ent_MapObjects.filter(e => e instanceof MapBB || e instanceof MapInteract)
        const found = []
        for (const zombie of this.engine.ent_Zombies) {
            if (zombie.removeFromWorld || zombie.hp <= 0) continue
            const dx = zombie.posX - player.posX
            const dy = zombie.posY - player.posY
            if (Math.abs(dx) > halfWidth || Math.abs(dy) > halfHeight) continue
            const distance = Math.hypot(dx, dy)
            if (distance > maxRange) continue
            found.push({zombie, distance})
        }
        found.sort((a, b) => a.distance - b.distance)
        return found.filter(c => !walls.some(wall => segmentHitsBox(player.posX, player.posY, c.zombie.posX, c.zombie.posY, wall.bb)))
    }

}

/** Signed smallest difference between two angles, in -PI..PI */
function angleDifference(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

/** Whether the segment from (x1, y1) to (x2, y2) passes through a BoundingBox (slab test). */
function segmentHitsBox(x1, y1, x2, y2, bb) {
    let tMin = 0
    let tMax = 1
    const dx = x2 - x1
    const dy = y2 - y1
    for (const [start, delta, low, high] of [[x1, dx, bb.x, bb.x + bb.width], [y1, dy, bb.y, bb.y + bb.height]]) {
        if (Math.abs(delta) < 1e-9) {
            if (start < low || start > high) return false
        } else {
            let t1 = (low - start) / delta
            let t2 = (high - start) / delta
            if (t1 > t2) [t1, t2] = [t2, t1]
            tMin = Math.max(tMin, t1)
            tMax = Math.min(tMax, t2)
            if (tMin > tMax) return false
        }
    }
    return true
}
