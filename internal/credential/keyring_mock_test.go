package credential

import "github.com/zalando/go-keyring"

func init() {
	keyring.MockInit()
}
