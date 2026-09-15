//TODO make into object to be configured
// const MIXER_MASTER = document.getElementById("volume").value
const MIXER_MUSIC_VOL = 0.8
const MIXER_AMB_VOL = 0.91
const MIXER_GUNSHOT_VOL = 0.9
const MIXER_GUNRELOAD_VOL = 0.2
const MIXER_CASH_ACCEPT = 0.2
const MIXER_POWERUP = 0.45
const MIXER_ZOMBIE_VOX = 0.425
const ZOMBIE_VOX_RADIUS = 3000
const MIXER_FOOTSTEP_VOL = 0.165
const MIXER_MAXIMUM_PAN_DISTANCE = 1000 //passing this px, it will go pan
const MIXER_RADIO_VOL = 1
const MIXER_LAVA_BURN = 0.15

// Every sound plays from a decoded AudioBuffer through one shared AudioContext.
// iOS Safari refuses HTMLAudioElement.play() unless each element is started from a tap,
// and it caps how many AudioContexts a page may open, so per-sound <audio> elements go silent on iPhone.
const AUDIO_CTX = new (window.AudioContext || window.webkitAudioContext)()
const AUDIO_BUFFER_BUDGET_BYTES = 96 * 1024 * 1024 //decoded PCM kept around for reuse; phones run out of memory fast
const AUDIO_BUFFERS = new Map() //path -> {promise, buffer, bytes, refs, lastUsed}
let audioBufferBytes = 0

if (navigator.audioSession) {
    navigator.audioSession.type = "playback" //keep playing when the iPhone ring/silent switch is on silent
}

function unlockAudio() {
    if (AUDIO_CTX.state !== "running") {
        AUDIO_CTX.resume()
    }
}
for (const type of ["touchstart", "touchend", "mousedown", "keydown", "click"]) {
    window.addEventListener(type, unlockAudio, {capture: true, passive: true})
}

function acquireAudioBuffer(path) {
    let entry = AUDIO_BUFFERS.get(path)
    if (entry == null) {
        entry = {buffer: null, bytes: 0, refs: 0, lastUsed: 0}
        entry.promise = fetch(path)
            .then(response => {
                if (!response.ok) throw new Error("HTTP " + response.status)
                return response.arrayBuffer()
            })
            .then(data => new Promise((resolve, reject) => AUDIO_CTX.decodeAudioData(data, resolve, reject)))
            .then(buffer => {
                entry.buffer = buffer
                entry.bytes = buffer.length * buffer.numberOfChannels * 4
                audioBufferBytes += entry.bytes
                evictAudioBuffers()
                return buffer
            })
            .catch(e => {
                console.log("Error loading " + path, e)
                if (AUDIO_BUFFERS.get(path) === entry) AUDIO_BUFFERS.delete(path)
                return null
            })
        AUDIO_BUFFERS.set(path, entry)
    }
    entry.refs++
    entry.lastUsed = performance.now()
    return entry
}

function releaseAudioBuffer(entry) {
    entry.refs = Math.max(0, entry.refs - 1)
    entry.lastUsed = performance.now()
    evictAudioBuffers()
}

function evictAudioBuffers() {
    if (audioBufferBytes <= AUDIO_BUFFER_BUDGET_BYTES) return
    let idle = [...AUDIO_BUFFERS.entries()]
        .filter(([, entry]) => entry.refs === 0 && entry.buffer != null)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [path, entry] of idle) {
        if (audioBufferBytes <= AUDIO_BUFFER_BUDGET_BYTES) break
        AUDIO_BUFFERS.delete(path)
        audioBufferBytes -= entry.bytes
    }
}

/**
 * Stand-in for the parts of HTMLAudioElement the game uses (play, pause, currentTime, paused, ended,
 * duration, volume, readyState, "ended" listeners), backed by a shared AudioBuffer.
 * Nothing is downloaded or decoded until the sound is played (or its readyState is checked),
 * because the maps create long music tracks up front that may never play.
 */
class BufferedAudio {
    constructor(path) {
        this.src = path
        this.entry = null
        this.output = AUDIO_CTX.createGain()
        this._volume = 1
        this.paused = true
        this.ended = false
        this.offset = 0
        this.startedAt = 0
        this.source = null
        this.playWhenReady = false
        this.released = false
        this.endedListeners = []
        this.failed = false
    }

    load() {
        if (this.entry != null || this.released) return
        let entry = acquireAudioBuffer(this.src)
        this.entry = entry
        entry.promise.then(buffer => {
            if (this.entry !== entry) return
            if (buffer == null) { //failed to load; end it so the owning entity can clean up
                this.failed = true
                this.paused = true
                this.ended = true
            } else if (this.playWhenReady && !this.released) {
                this.startSource()
            }
        })
    }

    unload() {
        if (this.entry == null) return
        releaseAudioBuffer(this.entry)
        this.entry = null
    }

    get buffer() {
        return this.entry != null ? this.entry.buffer : null
    }

    get readyState() {
        this.load()
        return (this.buffer != null || this.failed) ? 4 : 0
    }

    get duration() {
        return this.buffer != null ? this.buffer.duration : NaN
    }

    get volume() {
        return this._volume
    }

    set volume(vol) {
        this._volume = vol
        this.output.gain.value = vol
    }

    get currentTime() {
        if (this.source != null) {
            return Math.min(this.offset + AUDIO_CTX.currentTime - this.startedAt, this.duration)
        }
        return this.offset
    }

    set currentTime(sec) {
        let wasPlaying = this.source != null
        this.stopSource()
        this.offset = Math.max(0, sec)
        this.ended = false
        if (wasPlaying) this.startSource()
    }

    play() {
        if (this.released) return Promise.resolve()
        if (this.ended) { //like <audio>, playing an ended sound restarts it
            this.offset = 0
            this.ended = false
        }
        if (this.paused) {
            this.paused = false
            this.load()
            if (this.buffer != null) {
                this.startSource()
            } else {
                this.playWhenReady = true
            }
        }
        return Promise.resolve()
    }

    pause() {
        if (this.source != null) {
            this.offset = this.currentTime
            this.stopSource()
        }
        this.playWhenReady = false
        this.paused = true
    }

    startSource() {
        this.playWhenReady = false
        let buffer = this.buffer
        if (buffer == null) return
        if (buffer.duration <= 0 || this.offset >= buffer.duration) {
            this.paused = true
            this.ended = true
            return
        }
        let source = AUDIO_CTX.createBufferSource()
        source.buffer = buffer
        source.connect(this.output)
        source.onended = () => {
            if (this.source !== source) return
            this.source = null
            this.offset = buffer.duration
            this.paused = true
            this.ended = true
            if (this.endedListeners.length === 0) {
                this.unload() //finished one-shot: let the decoded audio be evicted until it plays again
            }
            this.endedListeners.forEach(listener => listener())
        }
        source.start(0, this.offset)
        this.source = source
        this.startedAt = AUDIO_CTX.currentTime
        this.entry.lastUsed = performance.now()
    }

    stopSource() {
        if (this.source == null) return
        let source = this.source
        this.source = null
        source.onended = null
        try {
            source.stop()
        } catch (e) {

        }
        source.disconnect()
    }

    addEventListener(type, listener) {
        if (type === "ended") this.endedListeners.push(listener)
    }

    remove() {
        if (this.released) return
        this.pause()
        this.released = true
        this.output.disconnect()
        this.unload()
    }
}

class WorldSound {
    constructor(path, volume=1,
                posX=0, posY=0,
                radius=1000, autorepeat=false,
                startTime = 0,
                playNow=true,
                autoDelete = true) {
        //Path, x, y, volume, auto repeat
        this.posX = posX;
        this.posY = posY;
        this.radius = radius
        this.startTime = startTime;
        this.autoDelete = autoDelete

        this.aud = new BufferedAudio(path);

        if (autorepeat) {
            this.aud.addEventListener("ended",  () => {
                this.aud.play();
            })
        }

        this.volume = Math.min(Math.max(0, volume), 1) //for getDistance to player
        this.aud.volume = this.volume
        this.aud.currentTime = this.startTime

        //panning
        this.panner = AUDIO_CTX.createStereoPanner ? AUDIO_CTX.createStereoPanner() : AUDIO_CTX.createGain()
        this.aud.output
            .connect(this.panner)
            .connect(AUDIO_CTX.destination)

        if (playNow) {
            this.aud.play();
        }
    }

    tryPlayOnlyIfPaused() {
        if (this.aud.paused || this.aud.ended) {
            this.aud.play()
        }
    }

    jumpToAndPlay(sec) {
        this.aud.pause()
        this.aud.currentTime = sec
        this.aud.play()
    }

    resetAndPlay() {
        this.aud.pause()
        this.aud.currentTime = 0
        this.aud.play()
    }

    resumePlay() {
        if (this.aud.paused) {
            this.aud.play()
        } else if (this.aud.ended) {
            this.resetAndPlay()
        }
    }

    hasEnded(){
        return this.aud.ended
    }

    getVolume() {
        return this.aud.volume * GAME_ENGINE.globalVolume
    }


    setVolume(vol) {
        if (vol < 0) {
            // console.log("Error: Volume" + vol)
            this.aud.volume = 0 //* GAME_ENGINE.options.globalVolume
        } else if (vol > 1) {
            // console.log("Error: Volume" + vol)
            this.aud.volume = GAME_ENGINE.globalVolume
        } else {
            this.aud.volume = vol * GAME_ENGINE.globalVolume
        }
        return this.aud.volume
    }

    getDistanceToPlayer() {
        let x = GAME_ENGINE.ent_Player.posX
        let y = GAME_ENGINE.ent_Player.posY
        let distance = Math.sqrt(((this.posX - x) * (this.posX - x)) + ((this.posY - y) * (this.posY - y)))
        return distance
    }

    getDistanceToPlayerXY() {
        let x = GAME_ENGINE.ent_Player.posX
        let y = GAME_ENGINE.ent_Player.posY
        return [(this.posX - x), (this.posY - y)] //yes, x is inverted
        // return [-1 * ((this.posX - x) / 1000), (this.posY - y)] //yes, x is inverted
    }


    getVolumeToPlayer() {
        return Math.pow( this.radius - this.getDistanceToPlayer(), 3) / Math.pow(this.radius,3)
    }

    update() {
        this.setVolume(this.getVolumeToPlayer() * this.volume)
        this.setPan(this.getDistanceToPlayerXY())
        if (this.aud.ended) {
            this.aud.onsuspend
            if (this.autoDelete) {
                this.soundDeleteGarbageCollect()
            }
        }
    }

    setPan(posXY) {
        // this.audCtx.listener.positionX.value = -1 * posXY[0]
        // this.audCtx.listener.positionY.value = posXY[1]

        if (this.panner.pan == null) return
        this.panner.pan.value = Math.min(Math.max(posXY[0] / MIXER_MAXIMUM_PAN_DISTANCE, -1), 1)
    }

    draw() {

    }

    soundDeleteGarbageCollect() {
        this.aud.remove()
        this.panner.disconnect()
        this.removeFromWorld = true
    }
}

class Sound extends WorldSound {
    constructor(path, volume=1, autorepeat=false, startime=0, playNow=true, autoDelete = true) {
        super(path, volume, 0,0,0, autorepeat, startime, playNow, autoDelete)
    }

    update() {
        this.setVolume(this.volume)
        if (this.aud.ended) {
            this.aud.onsuspend
            if (this.autoDelete) {
                this.soundDeleteGarbageCollect()
            }
        }
    }

}

class MysteryBoxSound extends WorldSound {
    constructor(path, posX, posY) {
        super(path, 0.5, posX, posY, 3000)
    }
}

// class GunSound extends Sound {
//     constructor(path, volume=1) {
//         super(path, volume * MIXER_GUNSHOT_VOL);
//     }
// }

// class SoundTest extends WorldSound {
//     constructor() {
//         super("Assets/Audio/SFX/Guns/Ray Gun.mp3", 1, GAME_ENGINE.ent_Player.posX, GAME_ENGINE.ent_Player.posY, 2000)
//     }
// }