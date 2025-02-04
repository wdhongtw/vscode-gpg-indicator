import * as assert from 'assert';

import * as gpg from './gpg';

describe('gpg', () => {
    describe('parseGpgKey', () => {
        it('should parse colon separated information', () => {
            // It's actually the output from my personal key, but since that
            // fingerprint and keygrip both are hash digest from public key,
            // it's should be safe to put here.
            const payload = [
                "tru::1:1722513572:1744888825:3:1:5\n",
                "pub:u:255:22:C728B2BDC9756E05:1530159720:1744888825::u:::cSC:::::ed25519:::0:\n",
                "fpr:::::::::BA6178432DE5A500A82820F6C728B2BDC9756E05:\n",
                "grp:::::::::D215899C4CB530235AA8B246C6517CDED9FE217A:\n",
                "uid:u::::1714648825::C8BF9DAE3B1C641A198985543B3C3CBB4D21F011::Sophia Taylor <sophia@example.com>::::::::::0:\n",
                "sub:u:255:22:8CC2E9CFB3BE270C:1590856399:1737983249:::::s:::::ed25519::\n",
                "fpr:::::::::B3D18BC755A7E11EC8F3A9028CC2E9CFB3BE270C:\n",
                "grp:::::::::CF1E56A855F60F97EAF98832039644B260803887:\n",
                "sub:e:255:18:D9CDAC5EE6730864:1603953223:1732792884:::::e:::::cv25519::\n",
                "fpr:::::::::1A1EAAA95D89C94C3AA65A41D9CDAC5EE6730864:\n",
                "grp:::::::::1F0037B4435708E8D07A01141D6F3C307C00DCBB:\n",
            ].join("");

            const infos = gpg.parseGpgKey(payload);

            assert.strictEqual(infos.length, 3);
            assert.deepStrictEqual(infos[0], {
                type: 'pub',
                capabilities: 'c',
                fingerprint: 'BA6178432DE5A500A82820F6C728B2BDC9756E05',
                keygrip: 'D215899C4CB530235AA8B246C6517CDED9FE217A',
                userId: 'Sophia Taylor <sophia@example.com>',
            });
            assert.deepStrictEqual(infos[1], {
                type: 'sub',
                capabilities: 's',
                fingerprint: 'B3D18BC755A7E11EC8F3A9028CC2E9CFB3BE270C',
                keygrip: 'CF1E56A855F60F97EAF98832039644B260803887',
                userId: undefined,
            });
            assert.deepStrictEqual(infos[2], {
                type: 'sub',
                capabilities: 'e',
                fingerprint: '1A1EAAA95D89C94C3AA65A41D9CDAC5EE6730864',
                keygrip: '1F0037B4435708E8D07A01141D6F3C307C00DCBB',
                userId: undefined,
            });
        });
    });
});
