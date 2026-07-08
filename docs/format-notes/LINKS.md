# Reference links for format & gameplay research

Format prose specs (primary — implement from these):
- Index: https://settlers2.net/documentation/
- LST: https://settlers2.net/documentation/lst-file-format/
- LBM: https://settlers2.net/documentation/graphics-files-lbm/
- BBM: https://settlers2.net/documentation/bbm-file-format/
- IDX/DAT: https://settlers2.net/documentation/idx-dat-file-format/
- WLD/SWD: https://settlers2.net/documentation/world-map-file-format-wldswd/
  and https://settlers2.net/documentation/map-files/
- Map objects tables: https://settlers2.net/documentation/objects/
- Palette & lighting (GOU tables): https://settlers2.net/2023/07/how-palette-and-lighting-works-in-the-settlers-2/
- Independent WLD/SWD spec: https://github.com/Merri/map-generator/wiki/WLD-&-SWD-File-Format
- General: https://moddingwiki.shikadi.net/wiki/The_Settlers_II

XMIDI:
- https://www.vgmpf.com/Wiki/index.php/XMI
- https://github.com/Mindwerks/wildmidi/blob/master/docs/formats/XMIFileFormat-AIL.txt

Reference implementation — GPL, consult for facts/ambiguities only, NEVER copy code:
- https://github.com/Return-To-The-Roots/libsiedler2 (src/Load*.cpp; BOB format is
  documented nowhere else — extract offsets/semantics into your own notes first,
  then implement independently)
- Gameplay constants: https://github.com/Return-To-The-Roots/s25client
  (libs/s25main/gameData/)
