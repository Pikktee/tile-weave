# Lessons Learned: 3D-Modell-UV-Aufbereitung für Tile Weave

Diese Dokumentation fasst die Erkenntnisse und Best Practices zusammen, die bei der Korrektur und Optimierung der UV-Mappings für 3D-Kleidungsmodelle (wie das `midi-dress.glb` und `custom-trousers-uv.glb`) gesammelt wurden. Sie dient als Leitfaden für die Aufbereitung zukünftiger 3D-Assets.

---

## 1. Proportionserhalt (Aspektverhältnis 1:1 wahren)

### Problem
Blenders Box- bzw. Würfelprojektion (`bpy.ops.uv.cube_project`) skaliert die U- und V-Achsen standardmäßig unabhängig voneinander auf den Bereich `[0, 1]`, wenn `scale_to_bounds=True` verwendet wird. Bei hohen und schmalen Kleidungsstücken (wie einem Kleid) führt dies zu einer massiven **horizontalen Stauchung** des Musters im Web-Viewer.

### Lösung
1. Die Projektion im Python-Skript immer mit `scale_to_bounds=False` ausführen.
2. Die UV-Koordinaten im Nachgang in Python manuell normalisieren, indem beide Achsen durch den maximalen Ausdehnungsfaktor geteilt werden:
   ```python
   # Ausdehnung berechnen
   width = max_u - min_u
   height = max_v - min_v
   max_dim = max(width, height)
   
   # Einheitlich skalieren (1:1 Seitenverhältnis erhalten)
   for uv_loop in dress_obj.data.uv_layers.active.data:
       uv_loop.uv[0] = (uv_loop.uv[0] - min_u) / max_dim
       uv_loop.uv[1] = (uv_loop.uv[1] - min_v) / max_dim
   ```

---

## 2. Naht-Risse verhindern (Mipmapping-Bleeding)

### Problem
Wenn UV-Koordinaten knapp außerhalb von `[0, 1]` liegen (z. B. durch ungenaue Projektionsgrenzen oder negative Koordinaten), führt das GPU-Mipmapping an den Panel-Grenzen zu Rundungsfehlern bei Texturabfragen. Im Viewport äußert sich das als **dünne weiße Risslinien/Streifen** entlang der Modellnähte.

### Lösung
Alle UV-Koordinaten müssen sich zwingend vollständig und präzise innerhalb des positiven Quadranten `[0, 1]` befinden:
1. Den minimalen U- und V-Wert aller Vertices ermitteln.
2. Das Minimum subtrahieren, sodass der kleinste Wert exakt bei `0.0` beginnt.
3. Durch manuelle Normalisierung sicherstellen, dass kein Wert `1.0` überschreitet.
4. Ggf. ein winziges Padding (z. B. `0.005`) einbauen, um sicherzustellen, dass keine Koordinaten durch Float-Ungenauigkeiten über die Grenzen springen.

---

## 3. Vertikale Ausrichtung (V-Axis Flipping für Three.js)

### Problem
Die V-Achse in WebGL/Three.js verläuft mathematisch von unten (0.0) nach oben (1.0). Der standardmäßige glTF-Exporter in Blender spiegelt beim Export jedoch die V-Achse (`v_gltf = 1.0 - v_blender`). Ohne manuelle Korrektur stehen Motive (z. B. Koalas) im Web-Viewer **auf dem Kopf**.

### Lösung
Die V-Achse muss vor dem Export im Python-Skript gespiegelt werden.
* **Falsch:** Ein einfaches Invertieren des Vorzeichens (`uv.y = -uv.y`) erzeugt ungültige negative Werte und führt zu Darstellungsfehlern.
* **Richtig:** Die Formel ausgehend von den normierten Werten lautet:
  ```python
  v_final = 1.0 - v_norm
  ```

---

## 4. Stale Pointer in der Blender-Python API (Memory Management)

### Problem
Blender verwaltet Mesh-Daten im Hintergrund in C++. Wenn man zwischen Modi wechselt (z. B. `bpy.ops.object.mode_set(mode='EDIT')` und zurück zu `'OBJECT'`) oder topologische Operationen durchführt (z. B. Weld/`remove_doubles`), werden die Arrays im C++-Kern neu im Speicher allokiert.
Zuvor in Python gespeicherte Referenzen auf UV-Layer-Daten (`uv_layer = obj.data.uv_layers.active`) werden dadurch **stale** (ungültig). Ein Zugriff liefert entweder willkürliche Garbage-Float-Werte (z. B. `10^37`), stürzt ab oder überschreibt das Mapping mit Datenmüll.

### Lösung
Nach jedem Moduswechsel oder topologischen Operationen müssen alle Referenzen auf UV-Layer und Mesh-Daten zwingend neu abgerufen werden:
```python
# Modus wechseln
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.remove_doubles(threshold=0.001)
bpy.ops.object.mode_set(mode='OBJECT')

# WICHTIG: Referenz neu holen, da die alte stale ist!
dress_obj = bpy.context.active_object
uv_layer = dress_obj.data.uv_layers.active
```

---

## 5. Mesh-Vorbereitung und topologische Kriterien

* **Schnittteil-UVs vs. Projektion:** Standard-UVs aus Marvelous Designer/CLO3D haben oft ungleiche Texeldichten (z. B. das Oberteil ist dichter gepackt als Rockbahnen). Das führt zu unterschiedlichen Rapportgrößen am Körper. Eine einheitliche Box-/Würfelprojektion über das gesamte Modell löst dieses Problem und sichert eine konsistente Rapportgröße.
* **Weld (Remove Doubles):** Viele Marvelous-Designer-Exporte trennen die Schnittteile als eigenständige, nicht verbundene Vertices entlang der Nähte. Vor der Projektion sollten diese Vertices im Edit-Mode verschweißt (`remove_doubles`) werden, um glattere Übergänge und eine konsistente Projektion zu gewährleisten.
* **Geometrie-Filterung:** Wenn das Modell Verzierungen oder Accessoires (wie Knöpfe, Schnallen oder Schuhe) enthält, sollten diese vor der Texturierung isoliert werden. Das kann entweder im Python-Skript geschehen (Zuweisung eines separaten Materials wie `button`) oder durch Löschen überflüssiger Geometrie (z. B. schwebende Schuhe).
* **Vermeidung geschlossener Innendeckel:** Hals-, Arm- und Saumöffnungen des Kleides dürfen im 3D-Modell keine flachen Deckelflächen aufweisen. Beim Blick in das Kleid würden diese Deckel sonst wie eine gemusterte Platte wirken. Das Mesh muss innen hohl sein.
