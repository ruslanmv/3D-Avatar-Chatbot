/**
 * A minimal zip writer for tests: stored or deflated entries, and a symlink flag — enough
 * to build the hostile archives an importer must refuse, and real packs it must accept.
 */
const zlib = require('zlib');

function zip(entries) {
    const locals = [];
    const central = [];
    let offset = 0;
    entries.forEach(({ name, data, deflate = false, symlink = false }) => {
        const body = deflate ? zlib.deflateRawSync(data) : data;
        const nameBytes = Buffer.from(name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(deflate ? 8 : 0, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(deflate ? 8 : 0, 10);
        header.writeUInt32LE(body.length, 20);
        header.writeUInt32LE(data.length, 24);
        header.writeUInt16LE(nameBytes.length, 28);
        header.writeUInt32LE(symlink ? 0o120777 * 0x10000 : 0, 38);
        header.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, body);
        central.push(header, nameBytes);
        offset += 30 + nameBytes.length + body.length;
    });
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

module.exports = { zip };
