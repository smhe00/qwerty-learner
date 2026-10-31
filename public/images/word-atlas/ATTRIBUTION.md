# Word illustrations

Word Atlas contributors — CC BY 4.0

Source: https://github.com/designfuchen/word-atlas

License: https://creativecommons.org/licenses/by/4.0/

Source commit: 99c007673d38f02c418d8e4cd2e9ec90b5d40be5

2,207 original 512px WebP files selected for the Shanghai 2027 desktop learning and dictation presentation. Image bytes/pixels are unmodified. The registry covers 2,209 syllabus entries (2,207 distinct headwords; duplicate entries share assets) and pins each original image SHA-256 and first source meaning as a lookup guard. A scene may illustrate one of the word's existing syllabus senses; it does not replace or define all senses. Dictionary text and examples are unchanged.

The expansion compared source meanings with existing syllabus senses and screened all candidate images in contact sheets. This is a coarse suitability screening, not a claim that every generated detail is correct. Forty-seven candidate entries with incompatible/uncertain senses are disabled; 616 entries have no directly matched source image. See docs/data/shanghai-2027-image-audit.json for the complete coverage and exclusions. The original 50-image pilot had a more detailed individual review; acceptance of the expanded set is staged on eTest.

Regenerate metadata and copy unchanged originals with:

    node scripts/import-study-illustrations.mjs <QWERTY_Plus_Shanghai2027_Image_Assets-directory>

Attribution, project and license links are also available in the site's About dialog. No per-image caption is displayed.

## Supplementary daily examples and scene pairing

Daily example English/Chinese text is also attributed to Word Atlas contributors under the same CC BY 4.0 license and pinned source commit. The selected originals are retained in scripts/data/word-atlas-daily-source.json; display adds target masking and a source-category label. No IELTS examples are imported. Authoritative syllabus JSON remains byte-identical.

The later daily-example review supersedes the broad image registry for **on-screen eligibility**: a stored image is displayed only with an explicitly reviewed, compatible daily example. This does not delete the other 2,207 stored image assets. See docs/data/shanghai-2027-example-audit.json for accepted, deferred and unreviewed content, and scripts/data/study-example-reviews.json for separate language/image decisions and limitations. This is Codex screening, not independent human certification. The picture represents one compatible moment, not every clause or invisible time/frequency detail.
