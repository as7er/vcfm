/** LZ 字典压缩的 UTF-16 存储封装，适合 localStorage。 */

function compress(input, bitsPerChar, getChar) {
  if (input == null) return "";
  const dictionary = Object.create(null);
  const toCreate = Object.create(null);
  let c = "";
  let wc = "";
  let w = "";
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  const data = [];
  let dataVal = 0;
  let dataPosition = 0;

  const writeBit = (bit) => {
    dataVal = (dataVal << 1) | bit;
    if (dataPosition === bitsPerChar - 1) {
      dataPosition = 0;
      data.push(getChar(dataVal));
      dataVal = 0;
    } else {
      dataPosition++;
    }
  };
  const writeBits = (count, value) => {
    for (let i = 0; i < count; i++) {
      writeBit(value & 1);
      value >>= 1;
    }
  };
  const reduceEnlarge = () => {
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  };

  for (let i = 0; i < input.length; i++) {
    c = input.charAt(i);
    if (dictionary[c] == null) {
      dictionary[c] = dictSize++;
      toCreate[c] = true;
    }
    wc = w + c;
    if (dictionary[wc] != null) {
      w = wc;
      continue;
    }

    if (toCreate[w]) {
      const code = w.charCodeAt(0);
      if (code < 256) {
        writeBits(numBits, 0);
        writeBits(8, code);
      } else {
        writeBits(numBits, 1);
        writeBits(16, code);
      }
      reduceEnlarge();
      delete toCreate[w];
    } else {
      writeBits(numBits, dictionary[w]);
    }
    reduceEnlarge();
    dictionary[wc] = dictSize++;
    w = c;
  }

  if (w !== "") {
    if (toCreate[w]) {
      const code = w.charCodeAt(0);
      if (code < 256) {
        writeBits(numBits, 0);
        writeBits(8, code);
      } else {
        writeBits(numBits, 1);
        writeBits(16, code);
      }
      reduceEnlarge();
      delete toCreate[w];
    } else {
      writeBits(numBits, dictionary[w]);
    }
    reduceEnlarge();
  }

  writeBits(numBits, 2);
  while (true) {
    dataVal <<= 1;
    if (dataPosition === bitsPerChar - 1) {
      data.push(getChar(dataVal));
      break;
    }
    dataPosition++;
  }
  return data.join("");
}

function decompress(length, resetValue, getNextValue) {
  if (!length) return "";
  const dictionary = [0, 1, 2];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = "";
  const result = [];
  let w;
  let bits;
  let maxPower;
  let power;
  let c;
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  const readBits = (count) => {
    let value = 0;
    let bitPower = 1;
    const max = 2 ** count;
    while (bitPower !== max) {
      const bit = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      if (bit > 0) value |= bitPower;
      bitPower <<= 1;
    }
    return value;
  };

  switch (readBits(2)) {
    case 0:
      c = String.fromCharCode(readBits(8));
      break;
    case 1:
      c = String.fromCharCode(readBits(16));
      break;
    default:
      return "";
  }
  dictionary[3] = c;
  w = c;
  result.push(c);

  while (true) {
    if (data.index > length) return "";
    bits = readBits(numBits);
    switch (bits) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(readBits(8));
        bits = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(16));
        bits = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join("");
      default:
        break;
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    if (dictionary[bits] != null) entry = dictionary[bits];
    else if (bits === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

export function compressToUTF16(input) {
  if (input == null) return "";
  return compress(input, 15, (value) => String.fromCharCode(value + 32)) + " ";
}

export function decompressFromUTF16(input) {
  if (input == null) return "";
  if (input === "") return null;
  return decompress(input.length, 16384, (index) => input.charCodeAt(index) - 32);
}
