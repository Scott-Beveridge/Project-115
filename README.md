<img src="Assets/Images/Logo.png" alt="Project 115" width="300" height="150" style="display: block; margin: 0 auto"> <br>
## Play Now
https://varunparbhakar.github.io/Project-115/
### About
A 2D top down clone of Call of Duty Zombies in HTML & JavaScript featuring a reimagine of BO2 Town, WaW and BO1 guns, custom made music and scuffed voice acting. <br>
### Trailer
[![Trailer](https://i.ytimg.com/vi/tio99lsWwMc/hqdefault.jpg?sqp=-oaymwEcCNACELwBSFXyq4qpAw4IARUAAIhCGAFwAcABBg==&rs=AOn4CLBQ3PfIrlQzoRN4-letMlw4Kz5hTg)](https://www.youtube.com/watch?v=tio99lsWwMc)
## Phone & Controller
Open the game on your phone in Safari, tap **Share → Add to Home Screen**, then launch it from the new icon while you have internet. It saves itself for offline play (about 90 MB) and shows "Saved for offline play" when it's done. After that it runs in airplane mode.

- **Controller** (Backbone, Xbox, PlayStation): Left stick move (click to sprint), right stick aim, RT shoot, LT/B knife, A buy/use, X reload, Y switch weapons, RB grenade, Menu pause. In menus, either stick moves the cursor and A clicks.
- **Touch**: left thumb moves (push to the edge to sprint), right thumb aims. Hold FIRE or KNIFE to keep attacking and drag from them to aim. BUY appears when there's something to buy, tap the gun in the top-right to switch weapons, plus RELOAD and NADE. The HUD moves to the top corners so your thumbs don't cover it.

- **Aim assist** (off by default; Options or the pause menu): with touch, holding FIRE or KNIFE without dragging turns you to the nearest zombie you can hit. Holding the right aim thumb for longer than half a second (claw grip) switches to controller behaviour instead: aiming near a zombie locks onto it, aiming elsewhere doesn't. A quick bump of the aim thumb doesn't count. On a controller, aiming within ~20 degrees of a zombie locks on, and holding RT with the right stick untouched picks the nearest. Mouse aiming is never assisted.

Game updates download in the background and apply the next time the game is opened. After adding or renaming assets, run `python3 tools/make_offline_list.py` so they're included in the offline copy.

## Credits
### TCSS 491 A - Blue 5 
- Varun Parbhakar: Coding, Textures, Mapping, Voice Acting<br>
- David Huynh: Coding, Music, Textures, Mapping, Voice Acting <br>
  - OST: https://soundcloud.com/david-huynh-136271687/sets/project-115-ost
- Yacine Bennour: Coding, Mapping, UX Designer <br>
### Other
- Chris Marriott: Empty Javascript Game Engine https://github.com/algorithm0r/Empty--GameEngine
- Treyarch: CoD Zombies, WaW Gun Sounds, BO1 Gun Sounds, Perk Music
  - https://steamcommunity.com/sharedfiles/filedetails/?id=948510972
  - https://steamcommunity.com/sharedfiles/filedetails/?id=1832129908
- Deepnight Games: RPG Map Maker 2 https://deepnight.net/tools/rpg-map/#:~:text=RPG%20Map%20is%20a%20tabletop,Forum
- Im-Not-Crying: Gun pixel spritesheet https://www.deviantart.com/im-not-crying/art/Nazi-Zombies-Weapons-and-Power-Ups-346007584
- Im-Not-Crying: Hud elements spritesheet https://www.deviantart.com/im-not-crying/art/Nazi-Zombies-HUD-Elements-346013662
- rileygombart: Player spritesheets https://opengameart.org/content/animated-top-down-survivor-player
- rileygombart: Zombie spritesheets https://opengameart.org/content/animated-top-down-zombie
### Known Issues
- For Edge Users, you can hide the double left click popup menu in that same menu.
- Firefox runs extremely poorly with constant lag spikes. It might be how Audio objects are created for each sound. We don't have a fix.
