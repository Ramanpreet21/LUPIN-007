# Workspace Notch Corner Border Verification

The failed visual edit was traced to a stale target: the live workspace notch seam is a sibling overlay after the focus-module section, rather than a sub-element of the targeted section.

The correction now renders the notch seam through two non-interactive pseudo-elements. A neutral track follows the cutout’s top and left edges, while a restrained specular highlight restores the rounded concave corner. The seam sits below the Agent Status dock and leaves the conversation surface and input bar unobstructed.

The live desktop command deck was inspected after the change and the restored corner line is visible at the notch entrance.
