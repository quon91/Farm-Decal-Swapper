# Farm Decal Swapper

Put your farm logo on Farming Simulator 25 mods, swap or hide any texture, and add your own brand choices to the shop. You don't need GIANTS Editor, Blender or an image editor.

## What it does

- **Finds the logos for you.** Open a vehicle, trailer or placeable and the app reads its 3D model. It shows which textures are logos or decals, where each one sits, and how big it is in metres.
- **Puts your logo on them, sized correctly.** Decals are often stretched on the model. The app corrects for that, so your logo comes out with the right proportions.
- **Adds logos where there were none.** Open the 3D view, click anywhere on the model and a logo sticker lands right there. Set its size and angle, nudge it into place, and tick one box to put a matching one on the other side.
- **Lets you pick placed logos in the shop.** Turn on *Pick the logo in the shop* and the vehicle's configure screen gets a "Farm logo" choice: any logos you tick, or none.
- **Puts your own licence plates on.** Your letters and your design (from the Logo maker) on the vehicle's plate spots, replacing the game's plate, with each vehicle numbered in turn. Or add a mount for the game's own plate anywhere.
- **Makes logos.** The Logo maker builds a logo from a layout (seal, shield, oval, patch, door logo, horizontal, name only, picture only, words in two lines or one, licence plate, wide licence plate), a picture (Delta farm scenes, cotton, rice, mallards, bins, excavator, hard hat, oak, bull, semi, pines, wheat), your words and colours, and adds it to your library at 2048 px.
- **Takes pictures, and makes shop pictures.** The Snapshot button saves the 3D view as a picture with your logo on it, for thumbnails, posts and stream graphics. The **512 × 512 · shop picture** size fills the frame with the vehicle on a see-through background, and **Use as the shop picture** puts it in the mod as the picture the shop shows.
- **Shows the vehicle as the shop does.** The 3D view shows the parts the default shop choices show, the wheels (from the mod, or the game's own wheels once it knows where the game is installed), and the default paint and textures.
- **Adds shop choices.** Many vehicles have a decal option in the shop, like door logos. You can tick any logos from your library to add each one as a new choice, and pre-select one.
- **Swaps, hides or paints any texture.** Replace part or all of a texture with a picture, make a decal see-through, or paint it one flat colour.
- **Keeps a logo library.** It holds as many logos as you like, at full resolution. If a logo comes on a white or solid background, the app can remove it. You can also save a logo you find inside a mod straight into your library.
- **Edits mod files.** Browse every file in a mod and edit the XML in a text view. The app won't keep XML that the game couldn't load.
- **Keeps quality high.** By default textures are saved without compression loss, and small decals are enlarged up to 2048 px.
- **Backs up before saving.** It copies the original mod before saving over it.
- **Works offline.** Nothing is uploaded, and it needs no account.

## Install (Windows)

1. Download **Farm-Decal-Swapper-win-x64.zip** from the [Releases](../../releases) page.
2. Unzip it anywhere, for example into `Documents\Farm Decal Swapper`.
3. Run **Farm Decal Swapper.exe**.

The app isn't code-signed, so Windows SmartScreen may say *Windows protected your PC*. Click **More info**, then **Run anyway**.

## How to use it

1. **Add your logos.** Go to **Logo library**, click **Add logos** and pick PNGs. A PNG with a see-through background works best. For a JPG or a logo on a solid colour, click **Remove background**. The logo's name is what shows in the shop.
2. **Open a mod.** The **Mods** screen lists your FS25 mods folder (`Documents\My Games\FarmingSimulator2025\mods`). Badges show your copies, mods with your logos, and mods you haven't edited. Click a mod, or drop any mod zip on the window.
3. **Change it.**
   - **Logos & decals**: click a texture and choose *Logo*, *Picture*, *Hide* or *Colour*. Tick the spots on the model you want to change, or drag a box over any area. Then click **Apply**.
   - **Place logos**: pick a model and a logo, then click the model where you want the logo. Drag to turn the view, right-drag to move it, scroll to zoom. Use the sliders and arrows to size and position it. The logo bends over curves and wraps round corners like vinyl; untick **Wrap round sharp corners** to keep it on one face. Tick **Also put it on the other side** for a matching sticker on the far side. Tick **Pick the logo in the shop** to choose the logo (or none) in the vehicle's configure screen instead of fixing one. **Snapshot** (top right of the 3D view) saves a picture with your logo on it.
   - **Shop options**: rename each vehicle as the shop shows it, rename the existing decal choices, and tick logos to add them as new choices. A choice whose picture you replaced with a logo takes the logo's name automatically.
   - **All textures**: does the same as *Logos & decals*, for every texture in the mod.
   - **Files**: edit XML such as the store name or price, then click **Keep these edits**.
4. **Save the mod.** The app suggests saving over the original. A backup goes to `Documents\Farm Decal Swapper\Backups` first. For a ModHub mod, save it as your own copy (see below).
5. **Start the game.** New shop choices appear at the end of the list in the configure screen.

### Logo maker

Go to **Logo maker**, click a starting point (Farm, Construction, Landscaping, Livestock, Hauling, Timber, Grain, Licence plate or Words only), then change the layout, picture, words, lettering and colours. The **Words (two lines)** and **Words (one line)** layouts make lettering-only logos with a second lettering for the second line, and solid, solid-with-a-line or outline letters. **White** and **Black** make one-colour versions for dark and light paint. **Add to library** puts it straight into your Logo library. Logos made in the Logo maker keep their settings: in the Logo library, click **Edit in Logo maker** to change the words, lettering, colours or picture, then **Save changes** (or **Add as new** to keep both). Logo packs carry these settings too. In the Logo maker, **Picture size** and dragging in the preview move and size the picture inside its frame, and **Or a logo from your library** puts any library logo (your farm logo, say) inside a crest, seal or shield.

**My pictures** (at the bottom of the Logo library) keeps photos, in-game screenshots and 3D views of your mods for the Logo maker. Click **Add pictures**, or in the Logo maker click **Save to My pictures** after loading a photo or **From a mod's 3D view**. Plain backgrounds are cut out when you add them. Packs export and import your pictures too, and skip anything you already have.

### Good to know

- **Hidden decals that show black in game:** some models don't support see-through on that part. Open the texture again and use **Colour** to match the paint instead.
- **Placed logos:** each one is a thin sticker that follows the surface 4 mm off the part you clicked, so it moves with that part (a logo on a door opens with the door). It always shows; it isn't a shop choice. It stays on the part you clicked, so a logo that runs past the edge of a door is trimmed there.
- **ModHub mods say they need an update:** the game compares ModHub mods with the official file, and an edited one no longer matches. Updating it downloads the original over your changes. In *Settings → Your own copies*, type a short name tag (for example your farm's initials) and tick **Always save edited mods as my own copy**: `FS25_Workstar_Pack` is saved as `FS25_DBF_Workstar_Pack`, so the game treats it as a separate mod. Also tick **move the original out of the mods folder and switch my savegames to my copy** and the app moves the original to `Documents\Farm Decal Swapper\Original mods` and points your savegames at your copy, so vehicles and buildings you already own keep working. Savegame files are backed up first, and the original stays put if another mod needs it. Close the game before saving. Tick **List my copies’ vehicles under my own brand in the shop** (same Settings box) and give the brand a name and logo: the app adds a small `FS25_TAG_Brand` mod that creates the brand, and your copies' vehicles are listed under it in the shop's Brands. **Put copies already in my mods folder under the brand** does the same for copies you made earlier (each is backed up first). Buildings aren't listed by brand in the game. Already have edited mods that still use their ModHub name (for example ones you saved over before using copies)? Click **Fix “needs updating” mods** on the Mods screen: mods edited with the app are ticked for you, and you can tick any others the game flags. Each ticked mod is renamed, tagged, and your savegames are switched to it. Renaming the vehicles in the shop doesn't stop the message, because the game goes by the zip file name.
- **Licence plates:** in **Place logos**, choose **Licence plate**, then **My own plate**. Type the letters (the next number is filled in for you, such as `DBF 001`) and pick a design: the standard plate in your farm colours, or any plate you made in the Logo maker with the **Licence plate** or **Licence plate (wide)** layout. If the vehicle already has plate spots, **Put my plate on them** puts your plate exactly where the game's plates go and takes the game's plates off, so only yours show. You can also click anywhere on the model to add another one. Your plate is part of the model, so it shows the same on every copy of that vehicle and doesn't change with the map. Each vehicle you save gets the next number. **Game plate** instead adds a mount for the game's own plate: the style comes from the map you play on, and you type its text in the shop.
- **Logo choice in the shop:** uses one of the game's eight design choices (`design` to `design8`) that the vehicle isn't using yet. Buildings have no configure screen, so their placed logos always show.
- **Game folder:** most mods use the game's own wheels, hubs and textures. *Settings → Game folder* finds the Farming Simulator 25 install by itself (Steam, Epic or the GIANTS version); if it can't, click **Choose game folder**. The app only reads from it. Without it, the 3D view still shows wheels that come with the mod.
- **Quality:** *Settings → Texture quality* switches between **Best** (no loss, a few MB per logo texture) and **Smaller files** (DXT5).
- **Moving your library:** **Export pack** saves your logo library as one zip, and **Import pack** loads it on another PC. When you import into a library that already has logos, choose **Add to my library** or **Replace my library with it** (your current library is saved as a pack in `Documents\Farm Decal Swapper\Backups` first).
- **Tidying your library:** search by name, **Select** several logos to delete them at once, and **Find duplicates** ticks copies of the same picture (keeping the biggest, or the one you can edit). **Save PNG** on any logo saves it as a file. Put logos in **folders** (type a folder name on the logo, or click **Sort into folders** to sort them by name); folders show as tabs in the library and in the logo picker, and travel with packs.
- **Picking a logo:** in Place logos, click the logo to open a picker with pictures, folders and search (type and press Enter to take the first match).
- **Which mods use a logo:** each logo shows the mods you saved it in (**Which mods use it?** also looks through your mods folder for ones saved earlier). After you change a logo in the Logo maker, **Update these mods** puts the new version into their placed logos, backing up each mod first. Logos painted into a mod's own textures need that mod opened and the logo applied again.
- **Recently opened mods** are listed first on the Mods screen.
- **Checking your mods:** **Check my mods for problems** (Mods screen) looks through every mod zip in your mods folder and the game's last `log.txt`. It finds mods zipped inside an extra folder (the game can't load them), XML the game can't read because of a bare `&`, files a mod points to under the wrong capital letters or folder, missing files, missing required mods, and the same mod in the folder twice (or your copy next to the original). Nothing changes until you tick a fix and click **Fix the ticked problems**; each mod is backed up first. Duplicates are moved to `Original mods` with your savegames switched to the one you keep. Script errors from the log are shown with advice; the app doesn't change scripts.
- **Your own shop section and build-menu category:** in *Settings → Your own copies*, list the shop tiles (each with a picture: your logo or any library logo) and build-menu tabs you want. In *Shop options*, pick a tile for each vehicle or a tab for each building. Saving adds a small script mod, `FS25_TAG_Categories`, that creates the section and category (it works the same way as the Chvck Farms categories mod), and makes the edited mod depend on it. Empty tiles and tabs don't show.
- **Brand and year:** in *Shop options*, items with no brand or year can be given one (pick a brand from the list, including your own). Brands and years they already have are left alone. The year goes in the item's `storeData` specs, where vehicle-year mods read it; the base game may not show it.
- **Mod authors' work:** patch mods for your own use. Don't re-upload someone else's mod without their permission.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
