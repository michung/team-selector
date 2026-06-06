/**
 * LZ-based string compression for URL sharing
 * Compresses JSON strings to shorter URL-safe base64
 */
export const LZString = {
    _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    
    compress: function(input) {
        if (input == null || input.length === 0) return "";
        const dict = new Map();
        const data = (input + "").split("");
        let out = [], phrase = data[0], code = 256;
        for (let i = 1; i < data.length; i++) {
            const currChar = data[i];
            if (dict.has(phrase + currChar)) {
                phrase += currChar;
            } else {
                out.push(phrase.length > 1 ? dict.get(phrase) : phrase.charCodeAt(0));
                dict.set(phrase + currChar, code++);
                phrase = currChar;
            }
        }
        out.push(phrase.length > 1 ? dict.get(phrase) : phrase.charCodeAt(0));
        
        // Convert to URL-safe base64
        let result = "";
        for (let i = 0; i < out.length; i++) {
            const val = out[i];
            result += this._keyStr.charAt((val >> 12) & 0x3F);
            result += this._keyStr.charAt((val >> 6) & 0x3F);
            result += this._keyStr.charAt(val & 0x3F);
        }
        return result;
    },
    
    decompress: function(input) {
        if (input == null || input.length === 0) return null;
        
        // Decode from URL-safe base64
        const data = [];
        for (let i = 0; i < input.length; i += 3) {
            const a = this._keyStr.indexOf(input.charAt(i));
            const b = this._keyStr.indexOf(input.charAt(i + 1));
            const c = this._keyStr.indexOf(input.charAt(i + 2));
            if (a < 0 || b < 0 || c < 0) return null;
            data.push((a << 12) | (b << 6) | c);
        }
        
        if (data.length === 0) return null;
        const dict = new Map();
        let currChar = String.fromCharCode(data[0]), oldPhrase = currChar, out = [currChar], code = 256;
        for (let i = 1; i < data.length; i++) {
            const currCode = data[i];
            let phrase;
            if (currCode < 256) {
                phrase = String.fromCharCode(currCode);
            } else {
                phrase = dict.has(currCode) ? dict.get(currCode) : (oldPhrase + currChar);
            }
            out.push(phrase);
            currChar = phrase.charAt(0);
            dict.set(code++, oldPhrase + currChar);
            oldPhrase = phrase;
        }
        return out.join("");
    }
};
