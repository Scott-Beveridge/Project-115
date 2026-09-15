/**
 * Phone and controller support layered on top of the keyboard/mouse input in GameEngine.
 * Gamepads (Backbone, Xbox, PlayStation) and on-screen touch controls write the same
 * key_* / left_click / mouse fields the keyboard and mouse handlers write.
 */

const MOBILE_MODE = new URLSearchParams(location.search).has("mobile") ||
    (navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches)

const CANVAS_MIN_WIDTH = 2560 //the menus are laid out for 2560x1440
const CANVAS_MIN_HEIGHT = 1440

const STICK_DEADZONE = 0.25
const STICK_DIAGONAL = 0.38 //sin(22.5deg): split the stick into 8 directions for WASD
const SPRINT_STICK_THRESHOLD = 0.92 //pushing the move stick to the edge sprints
//World px from the player to the virtual mouse. The game centres the camera halfway between the player and
//the mouse, so keeping this short keeps the camera on the player while the stick only turns them.
const AIM_DISTANCE = 100
const MENU_CURSOR_SPEED = 2200 //canvas px per second at full stick

const TOUCH_STICK_RADIUS_VMIN = 11
const TOUCH_MENU_SNAP_PX = 32 //screen px: a menu tap this close to a button counts as hitting it
const TOUCH_FIRE_AIM_DEADZONE = 0.3 //how far to drag from the FIRE button before it also aims
const TAP_RING_MS = 400

//Standard Gamepad API button indices
const PAD_A = 0, PAD_B = 1, PAD_X = 2, PAD_Y = 3, PAD_LB = 4, PAD_RB = 5, PAD_LT = 6, PAD_RT = 7,
    PAD_VIEW = 8, PAD_MENU = 9, PAD_L3 = 10, PAD_R3 = 11,
    PAD_UP = 12, PAD_DOWN = 13, PAD_LEFT = 14, PAD_RIGHT = 15

const CONTROL_NAMES = {
    use: {mouse: "F", pad: "A", touch: "BUY"},
    reload: {mouse: "R", pad: "X", touch: "RELOAD"},
}

/** The key or button for an action, for on-screen prompts, matching what the player is using right now. */
function controlName(action) {
    const input = GAME_ENGINE.mobileInput != null ? GAME_ENGINE.mobileInput.lastInput : "mouse"
    return CONTROL_NAMES[action][input]
}

const CONTROLS_HELP = {
    mouse: ["WASD - Move", "Shift - Sprint", "MouseL - Shoot", "MouseR - Knife", "F - Buy / Use", "R - Reload",
        "Q - Switch Weapons", "E - Throw Grenade", "ESC - Pause"],
    pad: ["Left Stick - Move (click to sprint)", "Right Stick - Aim", "RT - Shoot", "LT / B - Knife", "A - Buy / Use",
        "X - Reload", "Y - Switch Weapons", "RB - Throw Grenade", "Menu - Pause"],
    touch: ["Left thumb - Move (push to edge to sprint)", "Right thumb - Aim", "FIRE - Shoot (drag to aim while shooting)",
        "BUY - Buy / Use", "RELOAD, SWAP, NADE, KNIFE buttons", "II - Pause"],
}

function controlsHelpLines() {
    const input = GAME_ENGINE.mobileInput != null ? GAME_ENGINE.mobileInput.lastInput : "mouse"
    return CONTROLS_HELP[input]
}

class MobileInput {
    constructor(engine) {
        this.engine = engine
        //What each source currently holds down; merged into the engine fields only when they change,
        //so the keyboard keeps working alongside the controller
        this.padHeld = {}
        this.touchHeld = {}
        this.autoHeld = {}
        this.lastWritten = {}
        this.padButtonsLast = []
        this.padSprintLatched = false
        this.aimAngle = 0
        this.lastInput = "mouse" //"mouse" | "pad" | "touch"
        this.menuTapQueued = false //a menu tap waiting to be delivered as a fresh click
        this.menuFingerDown = false

        this.touches = new Map() //touch identifier -> role
        this.moveStick = null
        this.aimStick = null
    }

    init() {
        const canvas = this.engine.ctx.canvas
        if (MOBILE_MODE) {
            document.body.classList.add("mobile")
            document.getElementById("volume").value = 0.8
            this.fitCanvas()
            window.addEventListener("resize", () => this.fitCanvas())
            window.addEventListener("orientationchange", () => setTimeout(() => this.fitCanvas(), 300))
            this.buildTouchUI()
            //iPhone can't make a canvas fullscreen; the page already fills the screen
            FullscreenButton.prototype.use = () => {}
        }
        this.buildCursor()

        canvas.addEventListener("mousemove", () => this.lastInput = "mouse")
        window.addEventListener("keydown", () => this.lastInput = "mouse")

        //Poll before the engine reads input, and release taps after it has seen them
        const update = this.engine.update.bind(this.engine)
        this.engine.update = () => {
            this.pollGamepad()
            this.applyAim()
            this.applyAutoReload()
            this.deliverMenuTap()
            this.flush()
            update()
            if (this.touchHeld.left_click && !this.menuFingerDown && !this.isInGame()) {
                this.touchHeld.left_click = false
                this.flush()
            }
            if (MOBILE_MODE) this.fitCanvas()
            this.updateOverlays()
        }
    }

    //---------------------------------------------------------------- layout

    fitCanvas() {
        const canvas = this.engine.ctx.canvas
        //CSS stretches the canvas over the screen; match its pixel size to the displayed shape
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        const aspect = rect.width / rect.height
        let width = CANVAS_MIN_WIDTH
        let height = CANVAS_MIN_HEIGHT
        if (aspect >= width / height) {
            width = Math.round(height * aspect)
        } else {
            height = Math.round(width / aspect)
        }
        this.engine.options.fullscreen = false
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width
            canvas.height = height
            this.engine.ctx.imageSmoothingEnabled = false
        }
        //iPhone home screen apps can be left scrolled after rotating, which shifts touches away from what's drawn
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }

    isInGame() {
        const player = this.engine.ent_Player
        return player != null && player.alive && !this.engine.options.paused
    }

    //---------------------------------------------------------------- merging

    flush() {
        const fields = ["key_up", "key_down", "key_left", "key_right", "key_run", "key_reload",
            "key_use", "key_grenade", "key_switchGuns", "left_click", "right_click"]
        for (const field of fields) {
            const held = !!(this.padHeld[field] || this.touchHeld[field] || this.autoHeld[field])
            if (held !== !!this.lastWritten[field]) {
                this.engine[field] = held
                this.lastWritten[field] = held
            }
        }
    }

    setDirections(target, x, y) {
        const magnitude = Math.hypot(x, y)
        if (magnitude < STICK_DEADZONE) {
            target.key_up = target.key_down = target.key_left = target.key_right = false
            return 0
        }
        const threshold = STICK_DIAGONAL * magnitude
        target.key_left = x < -threshold
        target.key_right = x > threshold
        target.key_up = y < -threshold
        target.key_down = y > threshold
        return magnitude
    }

    //---------------------------------------------------------------- gamepad

    pollGamepad() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : []
        let pad = null
        for (const p of pads) {
            if (p != null && p.connected) {
                pad = p
                break
            }
        }
        if (pad == null) {
            if (this.padButtonsLast.length > 0) {
                this.padHeld = {}
                this.padButtonsLast = []
            }
            return
        }

        const button = i => pad.buttons[i] != null && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5)
        const pressedNow = i => button(i) && !this.padButtonsLast[i]
        const axis = i => pad.axes[i] || 0
        const lx = axis(0), ly = axis(1), rx = axis(2), ry = axis(3)
        const dpadX = (button(PAD_RIGHT) ? 1 : 0) - (button(PAD_LEFT) ? 1 : 0)
        const dpadY = (button(PAD_DOWN) ? 1 : 0) - (button(PAD_UP) ? 1 : 0)

        const anyActivity = pad.buttons.some((b, i) => button(i)) ||
            Math.hypot(lx, ly) > STICK_DEADZONE || Math.hypot(rx, ry) > STICK_DEADZONE
        if (anyActivity) this.lastInput = "pad"

        const held = {}
        if (this.isInGame()) {
            const stickMoving = Math.hypot(lx, ly) > STICK_DEADZONE
            const moveMagnitude = this.setDirections(held, stickMoving ? lx : dpadX, stickMoving ? ly : dpadY)
            if (pressedNow(PAD_L3)) this.padSprintLatched = true
            if (moveMagnitude === 0) this.padSprintLatched = false
            held.key_run = this.padSprintLatched || button(PAD_LB)

            held.left_click = button(PAD_RT)
            held.right_click = button(PAD_LT) || button(PAD_B) || button(PAD_R3)
            held.key_use = button(PAD_A)
            held.key_reload = button(PAD_X)
            held.key_switchGuns = button(PAD_Y)
            held.key_grenade = button(PAD_RB)

            if (Math.hypot(rx, ry) > STICK_DEADZONE) {
                this.aimAngle = Math.atan2(ry, rx)
            }
        } else if (this.lastInput === "pad") {
            //Menus: either stick or the d-pad moves the cursor, A clicks
            let cx = Math.abs(rx) > Math.abs(lx) ? rx : lx
            let cy = Math.abs(ry) > Math.abs(ly) ? ry : ly
            if (Math.hypot(cx, cy) < STICK_DEADZONE) {
                cx = dpadX
                cy = dpadY
            }
            const speed = MENU_CURSOR_SPEED * Math.min(1, Math.hypot(cx, cy)) * this.engine.clockTick
            const mouse = this.ensureMouse()
            const magnitude = Math.hypot(cx, cy)
            if (magnitude > STICK_DEADZONE) {
                mouse.x = Math.min(Math.max(0, mouse.x + (cx / magnitude) * speed), this.engine.ctx.canvas.width)
                mouse.y = Math.min(Math.max(0, mouse.y + (cy / magnitude) * speed), this.engine.ctx.canvas.height)
            }
            held.left_click = button(PAD_A)
        }

        if (pressedNow(PAD_MENU) || pressedNow(PAD_VIEW)) {
            const player = this.engine.ent_Player
            if (player != null && player.alive) {
                this.engine.options.paused = !this.engine.options.paused
            }
        }

        this.padHeld = held
        this.padButtonsLast = pad.buttons.map((b, i) => button(i))
    }

    ensureMouse() {
        if (this.engine.mouse == null) {
            this.engine.mouse = {x: this.engine.ctx.canvas.width / 2, y: this.engine.ctx.canvas.height / 2}
        }
        return this.engine.mouse
    }

    /**
     * The game aims at the mouse and centres the camera between the player and the mouse.
     * Place the virtual mouse so its world position sits just ahead of the player along the stick.
     */
    applyAim() {
        if (this.lastInput === "mouse" || !this.isInGame()) return
        const player = this.engine.ent_Player
        const camera = this.engine.camera
        const mouse = this.ensureMouse()
        mouse.x = player.posX + Math.cos(this.aimAngle) * AIM_DISTANCE - camera.posX
        mouse.y = player.posY + Math.sin(this.aimAngle) * AIM_DISTANCE - camera.posY
    }

    /** The game only reloads an empty gun on a fresh trigger pull; keep a held stick or trigger firing. */
    applyAutoReload() {
        this.autoHeld.key_reload = false
        if (this.lastInput === "mouse" || !this.isInGame()) return
        if (!(this.padHeld.left_click || this.touchHeld.left_click)) return
        const player = this.engine.ent_Player
        const gun = player.gunInventory[player.currentGunIndex]
        this.autoHeld.key_reload = gun != null && gun.currentMagazineAmmo === 0 && gun.currentTotalAmmo > 0
    }

    //---------------------------------------------------------------- touch

    buildTouchUI() {
        const ui = document.createElement("div")
        ui.id = "touchUI"
        ui.innerHTML = `
            <div class="stick" id="moveStick"><div class="knob"></div></div>
            <div class="stick" id="aimStick"><div class="knob"></div></div>
            <button class="tbtn" id="tPause" data-action="pause">II</button>
            <button class="tbtn" id="tFire" data-action="fire">FIRE</button>
            <button class="tbtn" id="tUse" data-hold="key_use">BUY<small>USE</small></button>
            <button class="tbtn" id="tReload" data-hold="key_reload">RELOAD</button>
            <button class="tbtn" id="tKnife" data-hold="right_click">KNIFE</button>
            <button class="tbtn" id="tNade" data-hold="key_grenade">NADE</button>
            <button class="tbtn" id="tSwap" data-hold="key_switchGuns">SWAP</button>
            <div id="rotateHint">Turn your phone sideways to play</div>
        `
        document.body.appendChild(ui)
        this.touchUI = ui
        this.moveStickEl = ui.querySelector("#moveStick")
        this.aimStickEl = ui.querySelector("#aimStick")

        const opts = {passive: false}
        ui.addEventListener("touchstart", e => this.onTouchStart(e), opts)
        ui.addEventListener("touchmove", e => this.onTouchMove(e), opts)
        ui.addEventListener("touchend", e => this.onTouchEnd(e), opts)
        ui.addEventListener("touchcancel", e => this.onTouchEnd(e), opts)
        //no double-tap zoom, text selection or long-press menus
        document.addEventListener("gesturestart", e => e.preventDefault())
        document.addEventListener("dblclick", e => e.preventDefault())
    }

    onTouchStart(e) {
        e.preventDefault()
        this.lastInput = "touch"
        for (const t of e.changedTouches) {
            if (this.isInGame()) {
                const btn = t.target.closest ? t.target.closest(".tbtn") : null
                if (btn != null) {
                    btn.classList.add("down")
                    if (btn.dataset.action === "pause") {
                        this.engine.options.paused = true
                        this.touchHeld = {}
                        this.touches.set(t.identifier, {type: "button", btn})
                    } else if (btn.dataset.action === "fire") {
                        //hold to shoot; drag while holding to aim as well
                        const r = btn.getBoundingClientRect()
                        this.touches.set(t.identifier, {type: "fire", btn, ox: r.left + r.width / 2, oy: r.top + r.height / 2})
                    } else {
                        this.touchHeld[btn.dataset.hold] = true
                        this.touches.set(t.identifier, {type: "button", btn})
                    }
                } else if (t.clientX < window.innerWidth / 2 && this.moveStick == null) {
                    this.moveStick = {id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0}
                    this.touches.set(t.identifier, {type: "move"})
                } else if (t.clientX >= window.innerWidth / 2 && this.aimStick == null) {
                    this.aimStick = {id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0}
                    this.touches.set(t.identifier, {type: "aim"})
                }
            } else {
                //Menus: a tap is a click where the finger lands
                this.touchToMouse(t)
                this.snapMouseToMenuButton()
                this.tapRingUntil = performance.now() + TAP_RING_MS
                this.menuTapQueued = true
                this.menuFingerDown = true
                this.touches.set(t.identifier, {type: "click"})
            }
        }
        this.updateTouchSticks()
        this.flush()
    }

    onTouchMove(e) {
        e.preventDefault()
        for (const t of e.changedTouches) {
            const role = this.touches.get(t.identifier)
            if (role == null) continue
            const radius = this.stickRadiusPx()
            if (role.type === "move" || role.type === "aim") {
                const stick = role.type === "move" ? this.moveStick : this.aimStick
                let dx = (t.clientX - stick.ox) / radius
                let dy = (t.clientY - stick.oy) / radius
                const magnitude = Math.hypot(dx, dy)
                if (magnitude > 1) {
                    //drag the base along so the stick never gets "stuck" far from the thumb
                    stick.ox = t.clientX - (dx / magnitude) * radius
                    stick.oy = t.clientY - (dy / magnitude) * radius
                    dx /= magnitude
                    dy /= magnitude
                }
                stick.x = dx
                stick.y = dy
            } else if (role.type === "fire") {
                const dx = (t.clientX - role.ox) / radius
                const dy = (t.clientY - role.oy) / radius
                if (Math.hypot(dx, dy) > TOUCH_FIRE_AIM_DEADZONE) {
                    this.aimAngle = Math.atan2(dy, dx)
                }
            }
            //menu taps ignore finger wiggle so a tap snapped onto a button stays on it
        }
        this.updateTouchSticks()
        this.flush()
    }

    onTouchEnd(e) {
        e.preventDefault()
        for (const t of e.changedTouches) {
            const role = this.touches.get(t.identifier)
            if (role == null) continue
            this.touches.delete(t.identifier)
            if (role.type === "button" || role.type === "fire") {
                role.btn.classList.remove("down")
                if (role.btn.dataset.hold) this.touchHeld[role.btn.dataset.hold] = false
            } else if (role.type === "move") {
                this.moveStick = null
            } else if (role.type === "aim") {
                this.aimStick = null
            } else if (role.type === "click") {
                //the click is released after the game has seen it for a frame
                this.menuFingerDown = false
            }
        }
        this.updateTouchSticks()
        this.flush()
    }

    /**
     * Menus only react to a click whose button was up the frame before. Deliver each tap as a clean
     * up-then-down, even if something left the click held (which would otherwise freeze every menu).
     */
    deliverMenuTap() {
        if (!this.menuTapQueued) return
        if (this.isInGame()) {
            this.menuTapQueued = false
            return
        }
        if (this.engine.left_click) {
            this.engine.left_click = false
            this.lastWritten.left_click = false
            this.padHeld.left_click = false
            this.touchHeld.left_click = false
        } else {
            this.touchHeld.left_click = true
            this.menuTapQueued = false
        }
    }

    /** Menu buttons are only ~16px tall on a phone; move a near miss onto the closest button. */
    snapMouseToMenuButton() {
        const canvas = this.engine.ctx.canvas
        const scale = canvas.width / canvas.getBoundingClientRect().width
        const mouse = this.engine.mouse
        let best = null
        let bestDistance = TOUCH_MENU_SNAP_PX * scale
        for (const bb of this.menuHitboxes()) {
            const dx = Math.max(bb.x - mouse.x, 0, mouse.x - (bb.x + bb.width))
            const dy = Math.max(bb.y - mouse.y, 0, mouse.y - (bb.y + bb.height))
            const distance = Math.hypot(dx, dy)
            if (distance === 0) return
            if (distance < bestDistance) {
                bestDistance = distance
                best = bb
            }
        }
        if (best != null) {
            mouse.x = Math.min(Math.max(mouse.x, best.x + 1), best.x + best.width - 1)
            mouse.y = Math.min(Math.max(mouse.y, best.y + 1), best.y + best.height - 1)
        }
    }

    /** Clickable areas in the open menus: any bounding box a few levels inside a front-end entity. */
    menuHitboxes() {
        const found = []
        const seen = new Set()
        const visit = (obj, depth) => {
            if (obj == null || typeof obj !== "object" || seen.has(obj) || depth > 5) return
            seen.add(obj)
            if (obj instanceof BoundingBox) {
                if (obj.width > 1 && obj.height > 1) found.push(obj)
                return
            }
            if (obj instanceof WorldSound || obj instanceof HTMLElement) return
            for (const value of Array.isArray(obj) ? obj : Object.values(obj)) visit(value, depth + 1)
        }
        for (const entity of this.engine.ent_FE) visit(entity, 0)
        return found
    }

    stickRadiusPx() {
        return Math.min(window.innerWidth, window.innerHeight) * TOUCH_STICK_RADIUS_VMIN / 100
    }

    touchToMouse(t) {
        const rect = this.engine.ctx.canvas.getBoundingClientRect()
        const mouse = this.ensureMouse()
        mouse.x = (t.clientX - rect.left) * (this.engine.ctx.canvas.width / rect.width)
        mouse.y = (t.clientY - rect.top) * (this.engine.ctx.canvas.height / rect.height)
    }

    updateTouchSticks() {
        const move = this.moveStick
        if (move != null) {
            const magnitude = this.setDirections(this.touchHeld, move.x, move.y)
            this.touchHeld.key_run = magnitude >= SPRINT_STICK_THRESHOLD
        } else {
            this.setDirections(this.touchHeld, 0, 0)
            this.touchHeld.key_run = false
        }

        //the aim stick only turns the player; shooting is the FIRE button
        const aim = this.aimStick
        if (aim != null && Math.hypot(aim.x, aim.y) > 0.15) {
            this.aimAngle = Math.atan2(aim.y, aim.x)
        }
        if (this.isInGame()) {
            this.touchHeld.left_click = [...this.touches.values()].some(role => role.type === "fire")
        }
    }

    //---------------------------------------------------------------- overlays

    buildCursor() {
        const cursor = document.createElement("div")
        cursor.id = "padCursor"
        cursor.hidden = true
        document.body.appendChild(cursor)
        this.cursorEl = cursor
    }

    updateOverlays() {
        const inGame = this.isInGame()
        const canvas = this.engine.ctx.canvas
        const canvasVisible = !canvas.hidden

        //A visible pointer for picking menu items with the controller, and a flash where a menu tap landed
        const showTapRing = this.lastInput === "touch" && performance.now() < (this.tapRingUntil || 0)
        const showCursor = canvasVisible && !inGame && (this.lastInput === "pad" || showTapRing) && this.engine.mouse != null
        if (showCursor) {
            const rect = canvas.getBoundingClientRect()
            this.cursorEl.style.left = (rect.left + this.engine.mouse.x * rect.width / canvas.width) + "px"
            this.cursorEl.style.top = (rect.top + this.engine.mouse.y * rect.height / canvas.height) + "px"
        }
        this.cursorEl.hidden = !showCursor

        if (this.touchUI == null) return
        //Touch controls stay out of the way while the controller is in use
        this.touchUI.classList.toggle("ingame", canvasVisible && inGame && this.lastInput !== "pad")
        if (!inGame && (this.moveStick != null || this.aimStick != null)) {
            this.moveStick = null
            this.aimStick = null
            for (const [id, role] of this.touches) {
                if (role.type !== "click") this.touches.delete(id)
            }
            this.touchUI.querySelectorAll(".tbtn.down").forEach(b => b.classList.remove("down"))
            this.touchHeld = {}
            this.autoHeld = {}
            this.flush()
        }
        this.drawStick(this.moveStickEl, this.moveStick)
        this.drawStick(this.aimStickEl, this.aimStick)
    }

    drawStick(el, stick) {
        if (stick == null) {
            el.classList.remove("active")
            return
        }
        const radius = this.stickRadiusPx()
        el.classList.add("active")
        el.style.left = stick.ox + "px"
        el.style.top = stick.oy + "px"
        el.firstElementChild.style.transform = `translate(${stick.x * radius}px, ${stick.y * radius}px)`
    }
}
