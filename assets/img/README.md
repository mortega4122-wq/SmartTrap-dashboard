# Website images

Pages look for these files. Until a file exists, its spot shows a plain block with corner registration marks and the file name it is waiting for. Photos are cropped to fill their box, so any size works, but landscape shots of at least 2000px wide look best for the heroes.

| File | Used on | Current photo |
|---|---|---|
| `hero-orchard.jpg` | Home page hero. On laptops and desktops the page sizes and places it so the trap sits right of the text box, using where the trap is in this photo (the `--subject-*` values under `.hero-boxed` in `site.css`), so re-measure those if you swap it. Exported 2600px wide (about 590 KB) because large screens show it close to full size. | MO_03918 |
| `hero-orchard-backdrop.jpg` | Soft blur behind the home hero photo, showing wherever the photo stops short of the screen's edge. Made from the leaves left of the trap, mirrored and heavily blurred, so remake it from any new hero photo. | MO_03918, left 35%, blurred |
| `product-hero.jpg` | Our Product page hero (full width behind white text on the left, so the subject should sit right of centre). `style="--focus: 50% 36%"` on its `<img>` keeps the trap in the crop on wide screens. | MO_03944, left 62% of the frame |
| `trap-field.jpg` | SmartTrap installed in an orchard (home page, product page) | MO_03919 |
| `gateway.jpg` | Field gateway (product page) | — |
| `dashboard.png` | Dashboard screenshot (home page, product page) | — |
| `team.jpg` | Team photo (About Us page) | — |
| `footer-orchard.jpg` | Photo in the footer contact card (every page) | MO_03932 |

"Current photo" is the camera file name of the original, from the 2026-09-25 orchard shoot.

Keep each photo under about 500 KB (export as JPG at ~80% quality) so pages load quickly.
